import { describe, it, expect, afterEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeConfigDir, claudeJsonPath } from '../../src/main/services/claudeConfigDir'

describe('claudeConfigDir', () => {
  const original = process.env.CLAUDE_CONFIG_DIR

  afterEach(() => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = original
  })

  it('defaults to ~/.claude when unset', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(claudeConfigDir()).toBe(join(homedir(), '.claude'))
  })

  it('defaults .claude.json to a SIBLING of ~/.claude, not inside it', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(claudeJsonPath()).toBe(join(homedir(), '.claude.json'))
  })

  it('honours an override for both the config dir and .claude.json', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/claude-home'
    expect(claudeConfigDir()).toBe('/custom/claude-home')
    expect(claudeJsonPath()).toBe(join('/custom/claude-home', '.claude.json'))
  })

  it('treats a blank override as unset', () => {
    process.env.CLAUDE_CONFIG_DIR = '   '
    expect(claudeConfigDir()).toBe(join(homedir(), '.claude'))
  })
})
