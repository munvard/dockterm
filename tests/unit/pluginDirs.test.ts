import { describe, it, expect, afterEach } from 'vitest'
import { claudeConfigDir } from '@main/services/pluginDirs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ENV_KEY = 'CLAUDE_CONFIG_DIR'
const original = process.env[ENV_KEY]

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
})

describe('claudeConfigDir', () => {
  it('defaults to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
    delete process.env[ENV_KEY]
    expect(claudeConfigDir()).toBe(join(homedir(), '.claude'))
  })

  it('honors CLAUDE_CONFIG_DIR when set, matching Claude Code CLI behavior', () => {
    process.env[ENV_KEY] = '/custom/claude-config'
    expect(claudeConfigDir()).toBe('/custom/claude-config')
  })

  it('falls back to the default for a blank/whitespace-only override', () => {
    process.env[ENV_KEY] = '   '
    expect(claudeConfigDir()).toBe(join(homedir(), '.claude'))
  })
})
