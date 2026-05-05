#!/bin/bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────
REMOTE_USER="hapa"
REMOTE_HOST="104.248.14.255"
REMOTE_PATH="/home/hapa/dockers/libre-relay-bot"
IMAGE_NAME="libre-relay-bot"
IMAGE_TAG="latest"
LOCAL_IMAGE_TAR="/tmp/libre-relay-bot-image.tar.gz"
REMOTE_IMAGE_TAR="/tmp/libre-relay-bot-image.tar.gz"
LOG_FILE="$(cd "$(dirname "$0")" && pwd)/deploylog.log"
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_PRODUCTION="$PROJECT_DIR/.env.production"
COMPOSE_REMOTE_FILE="$(cd "$(dirname "$0")" && pwd)/docker-compose-remote.yaml"
APP_CONTAINER_NAME="libre-relay-bot"

# ── Helpers ────────────────────────────────────────────────────────────────
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

log() { echo "[$(timestamp)] $*" | tee -a "$LOG_FILE"; }
log_ok() { log "$* ... OK"; }
log_fail() { log "$* ... FAILED"; }

step() {
  local name="$1"; shift
  log "Step $STEP_NUM: $name"
  local rc=0
  "$@" || rc=$?
  if [ $rc -eq 0 ]; then
    log_ok "Step $STEP_NUM: $name"
  else
    log_fail "Step $STEP_NUM: $name"
    log "Error: $name exited with code $rc"
    log "=== DEPLOY ABORTED ==="
    exit 1
  fi
  STEP_NUM=$((STEP_NUM + 1))
}

remote() { ssh "$REMOTE_USER@$REMOTE_HOST" "$@"; }

# ── Init ───────────────────────────────────────────────────────────────────
DEPLOY_START=$(date +%s)
STEP_NUM=1

log "=== DEPLOY START ==="

# ── Step 1: npm run build ──────────────────────────────────────────────────
do_npm_build() {
  cd "$PROJECT_DIR"
  npm run build > /tmp/lrb-build.log 2>&1
  local rc=$?
  if [ $rc -ne 0 ]; then
    cat /tmp/lrb-build.log >> "$LOG_FILE"
    return $rc
  fi
  rm -f /tmp/lrb-build.log
  return 0
}
step "npm run build" do_npm_build

# ── Step 2: docker build ──────────────────────────────────────────────────
do_docker_build() {
  docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" "$PROJECT_DIR" > /tmp/lrb-docker-build.log 2>&1
  local rc=$?
  if [ $rc -ne 0 ]; then
    tail -50 /tmp/lrb-docker-build.log >> "$LOG_FILE"
    rm -f /tmp/lrb-docker-build.log
    return $rc
  fi
  rm -f /tmp/lrb-docker-build.log
  return 0
}
step "docker build" do_docker_build

# ── Step 3: docker save ───────────────────────────────────────────────────
do_docker_save() {
  docker save "${IMAGE_NAME}:${IMAGE_TAG}" | gzip > "$LOCAL_IMAGE_TAR"
  local size
  size=$(du -h "$LOCAL_IMAGE_TAR" | cut -f1)
  log "Image tar size: $size"
}
step "docker save" do_docker_save

# ── Step 4: ensure remote directory and karmaMessages.json ────────────────
do_ensure_remote_files() {
  remote "mkdir -p ${REMOTE_PATH}"
  local karma_exists
  karma_exists=$(remote "test -f ${REMOTE_PATH}/karmaMessages.json && echo yes || echo no")
  if [ "$karma_exists" = "no" ]; then
    log "Uploading default karmaMessages.json"
    scp "$PROJECT_DIR/karmaMessages.json" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/karmaMessages.json"
  else
    log "karmaMessages.json already exists on remote — preserving"
  fi
}
step "Ensure remote directory and karmaMessages.json" do_ensure_remote_files

# ── Step 5: upload image ──────────────────────────────────────────────────
do_upload_image() {
  scp "$LOCAL_IMAGE_TAR" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_IMAGE_TAR}"
  rm -f "$LOCAL_IMAGE_TAR"
}
step "Upload image" do_upload_image

# ── Step 6: load image on SirLibre ────────────────────────────────────────
do_load_image() {
  remote "docker load < ${REMOTE_IMAGE_TAR}"
}
step "Load image on SirLibre" do_load_image

# ── Step 7: clean up image tar on SirLibre ────────────────────────────────
do_cleanup_remote_tar() {
  remote "rm -f ${REMOTE_IMAGE_TAR}"
}
step "Clean up image tar on SirLibre" do_cleanup_remote_tar

# ── Step 8: place .env ────────────────────────────────────────────────────
do_place_env() {
  if [ ! -f "$ENV_PRODUCTION" ]; then
    log "Error: ${ENV_PRODUCTION} not found"
    return 1
  fi
  scp "$ENV_PRODUCTION" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/.env"
  return 0
}
step "Place .env" do_place_env

# ── Step 9: upload docker-compose ──────────────────────────────────────────
do_upload_compose() {
  if [ ! -f "$COMPOSE_REMOTE_FILE" ]; then
    log "Error: ${COMPOSE_REMOTE_FILE} not found"
    return 1
  fi
  scp "$COMPOSE_REMOTE_FILE" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/docker-compose.yml"
  return 0
}
step "Upload docker-compose.yml" do_upload_compose

# ── Step 10: docker compose up (force-recreate) ────────────────────────────
do_compose_up() {
  remote "cd ${REMOTE_PATH} && docker compose up -d --force-recreate"
}
step "docker compose up -d --force-recreate" do_compose_up

# ── Step 11: verify container is running ──────────────────────────────────
VERIFY_MAX_WAIT=30

do_verify() {
  local attempts=0

  log "Waiting for container to be running (up to ${VERIFY_MAX_WAIT}s)..."
  while [ $attempts -lt $VERIFY_MAX_WAIT ]; do
    local status
    status=$(remote "docker inspect -f '{{.State.Status}}' ${APP_CONTAINER_NAME} 2>/dev/null" || echo "")
    if [ "$status" = "running" ]; then
      log "Container ${APP_CONTAINER_NAME} is running"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  log "Container did not reach running state within ${VERIFY_MAX_WAIT}s"
  remote "docker logs ${APP_CONTAINER_NAME} --tail 20" >> "$LOG_FILE" 2>&1 || true
  return 1
}
step "Verify deployment (container running)" do_verify

# ── Done ───────────────────────────────────────────────────────────────────
DEPLOY_END=$(date +%s)
ELAPSED=$((DEPLOY_END - DEPLOY_START))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

log "=== DEPLOY END === Elapsed: ${MINUTES}m ${SECONDS}s"
