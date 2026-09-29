import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseVoiceSettings, readVoiceSettings } from '../../src/main/services/claudeVoiceSettings'

describe('parseVoiceSettings', () => {
  it('defaults: off, hold, no auto-submit', () => {
    expect(parseVoiceSettings({})).toEqual({ enabled: false, mode: 'hold', autoSubmit: false })
    expect(parseVoiceSettings(null)).toEqual({ enabled: false, mode: 'hold', autoSubmit: false })
    expect(parseVoiceSettings([1])).toEqual({ enabled: false, mode: 'hold', autoSubmit: false })
  })

  it('reads the voice object', () => {
    expect(parseVoiceSettings({ voice: { enabled: true, mode: 'tap', autoSubmit: true } })).toEqual({
      enabled: true,
      mode: 'tap',
      autoSubmit: true
    })
  })

  it('accepts the legacy flat voiceEnabled', () => {
    expect(parseVoiceSettings({ voiceEnabled: true }).enabled).toBe(true)
  })

  it('voice.enabled wins over the legacy flag', () => {
    expect(parseVoiceSettings({ voice: { enabled: false }, voiceEnabled: true }).enabled).toBe(false)
  })

  it('ignores wrong types and unknown modes', () => {
    expect(
      parseVoiceSettings({ voice: { enabled: 'yes', mode: 'push', autoSubmit: 1 }, voiceEnabled: 'true' })
    ).toEqual({ enabled: false, mode: 'hold', autoSubmit: false })
    expect(parseVoiceSettings({ voice: 'on' }).mode).toBe('hold')
  })
})

describe('readVoiceSettings', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const dir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'dt-voice-'))
    dirs.push(d)
    return d
  }

  it('missing file means voice off', () => {
    expect(readVoiceSettings(dir())).toEqual({ enabled: false, mode: 'hold', autoSubmit: false })
  })

  it('invalid JSON means voice off', () => {
    const d = dir()
    writeFileSync(join(d, 'settings.json'), '{ nope')
    expect(readVoiceSettings(d).enabled).toBe(false)
  })

  it('reads settings.json from the given dir', () => {
    const d = dir()
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ voice: { enabled: true, mode: 'tap' } }))
    expect(readVoiceSettings(d)).toEqual({ enabled: true, mode: 'tap', autoSubmit: false })
  })
})
