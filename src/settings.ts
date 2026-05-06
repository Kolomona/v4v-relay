import fs from 'fs';
import path from 'path';
import { KarmaResponseSettings, RuntimeSettings } from './types';

const SETTINGS_PATH = path.resolve(__dirname, '..', 'data', 'settings.json');

const DEFAULT_SETTINGS: RuntimeSettings = {
  karmaResponse: {
    chance: 0.3,
    cooldownMs: 25_000,
    perTargetCooldownMs: 60_000
  }
};

let cachedSettings: RuntimeSettings = DEFAULT_SETTINGS;
let cachedMtimeMs: number | null = null;

function sanitizeKarmaResponseSettings(value: unknown): KarmaResponseSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Record<string, unknown>;
  const out: KarmaResponseSettings = {};

  if (typeof candidate.chance === 'number' && Number.isFinite(candidate.chance)) {
    out.chance = candidate.chance;
  }
  if (typeof candidate.cooldownMs === 'number' && Number.isFinite(candidate.cooldownMs)) {
    out.cooldownMs = candidate.cooldownMs;
  }
  if (typeof candidate.perTargetCooldownMs === 'number' && Number.isFinite(candidate.perTargetCooldownMs)) {
    out.perTargetCooldownMs = candidate.perTargetCooldownMs;
  }
  if (typeof candidate.perUserCooldownMs === 'number' && Number.isFinite(candidate.perUserCooldownMs)) {
    out.perUserCooldownMs = candidate.perUserCooldownMs;
  }

  return out;
}

function mergeWithDefaults(settings: RuntimeSettings): RuntimeSettings {
  return {
    karmaResponse: {
      ...DEFAULT_SETTINGS.karmaResponse,
      ...settings.karmaResponse
    }
  };
}

export function getRuntimeSettings(): RuntimeSettings {
  try {
    const stat = fs.statSync(SETTINGS_PATH);
    if (cachedMtimeMs !== null && stat.mtimeMs === cachedMtimeMs) {
      return cachedSettings;
    }

    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const runtimeSettings: RuntimeSettings = {};
    const karmaResponse = sanitizeKarmaResponseSettings(parsed.karmaResponse);
    if (karmaResponse !== undefined) {
      runtimeSettings.karmaResponse = karmaResponse;
    }

    const nextSettings: RuntimeSettings = mergeWithDefaults(runtimeSettings);

    cachedSettings = nextSettings;
    cachedMtimeMs = stat.mtimeMs;
    return cachedSettings;
  } catch (_error) {
    return cachedSettings;
  }
}

export function reloadSettings(): void {
  cachedSettings = DEFAULT_SETTINGS;
  cachedMtimeMs = null;
}
