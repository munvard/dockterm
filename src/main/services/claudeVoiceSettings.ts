import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeVoiceSettings } from '@shared/types'
import { claudeConfigDir } from './claudeConfigDir'

const DEFAULTS: ClaudeVoiceSettings = { enabled: false, mode: 'hold', autoSubmit: false }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Claude Code keeps voice mode in settings.json as `voice: { enabled, mode,
 * autoSubmit }` (older builds: a flat `voiceEnabled`). Anything missing or of
 * the wrong type falls back to the defaults: off, hold-to-talk, no auto-submit.
 */
export function parseVoiceSettings(raw: unknown): ClaudeVoiceSettings {
  if (!isRecord(raw)) return { ...DEFAULTS }
  const voice = isRecord(raw.voice) ? raw.voice : {}
  const enabled =
    typeof voice.enabled === 'boolean'
      ? voice.enabled
      : typeof raw.voiceEnabled === 'boolean'
        ? raw.voiceEnabled
        : false
  return {
    enabled,
    mode: voice.mode === 'tap' ? 'tap' : 'hold',
    autoSubmit: voice.autoSubmit === true
  }
}

/** Read-only. A missing or unreadable file is "voice off". */
export function readVoiceSettings(dir: string = claudeConfigDir()): ClaudeVoiceSettings {
  try {
    return parseVoiceSettings(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}
