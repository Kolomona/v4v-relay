#!/bin/bash
# Test Helipad webhook with comprehensive field coverage
# This sends a test payload to the remote relay server to verify formatter logic

set -euo pipefail

# Load production environment to get auth token
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.production"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

# Source the environment file and extract AUTHTOKEN
AUTH_TOKEN=$(grep '^AUTHTOKEN=' "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r' | tr -d "\"'" )

if [ -z "$AUTH_TOKEN" ]; then
  echo "Error: AUTHTOKEN not found in $ENV_FILE"
  exit 1
fi

HOST="${1:-104.248.14.255}"
PORT="${2:-7777}"

# Generate a random 2-digit number
RANDOM_NUM=$((RANDOM % 90 + 10))

echo "Sending comprehensive Helipad webhook test to $HOST:$PORT..."

curl -i -X POST "http://$HOST:$PORT/" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -d '{
    "direction": "incoming",
    "index": 100000,
    "time": 1778032800,
    "value_msat": 250000,
    "value_msat_total": 250000,
    "action": 2,
    "list_type": "boost",
    "sender": "Full Test User",
    "app": "Helipad",
    "message": "Testing with remote podcast and episode values! - '$RANDOM_NUM'",
    "podcast": "Main Podcast",
    "episode": "Episode 42",
    "remote_podcast": "Cross Podcast Show",
    "remote_episode": "Remote Episode 7",
    "tlv": "{\"action\":\"boost\",\"app_name\":\"Helipad\",\"app_version\":\"0.2.2\"}",
    "reply_sent": false,
    "custom_key": null,
    "custom_value": null,
    "memo": null,
    "payment_info": null
  }'
