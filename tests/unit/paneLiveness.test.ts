import { describe, it, expect } from 'vitest'
import { classify } from '@renderer/components/terminal/claudeStatus'
import {
  hasClaudeInputBox,
  claudeOnScreen,
  claudeIsForeground,
  unknownProcessLabel
} from '@renderer/components/terminal/paneLiveness'

const RULE = '─'.repeat(100)

/** Claude Code 2.1.284 idle screen, captured from a real pty run on 2026-09-29. */
const IDLE_CLAUDE = [
  ' ▐▛███▜▌   Claude Code v2.1.284',
  '▝▜█████▛▘  Opus 5.5 with high effort · Claude Max',
  '  ▘▘ ▝▝    ~/dockterm',
  '',
  RULE,
  '❯ ',
  RULE,
  '  ⏵⏵ auto mode on (shift+tab to cycle)'
].join('\n')

const OLD_BOX_IDLE = ['╭' + '─'.repeat(60) + '╮', '│ >                                                          │', '╰' + '─'.repeat(60) + '╯', '  ? for shortcuts'].join('\n')

const POWERSHELL = ['Windows PowerShell', '', 'PS C:\\Users\\me\\proj> '].join('\n')
const STARSHIP = ['~/proj on  main', '❯ '].join('\n')

describe('idle Claude on Windows (I3)', () => {
  it('an idle Claude screen classifies as idle, which is why the state alone was not enough', () => {
    expect(classify(IDLE_CLAUDE)).toBe('idle')
  })

  it('recognises the idle input box, new and old style', () => {
    expect(hasClaudeInputBox(IDLE_CLAUDE)).toBe(true)
    expect(hasClaudeInputBox(OLD_BOX_IDLE)).toBe(true)
    expect(claudeOnScreen(IDLE_CLAUDE)).toBe(true)
  })

  it('does not mistake a shell prompt for Claude, even a fancy one', () => {
    expect(hasClaudeInputBox(POWERSHELL)).toBe(false)
    expect(hasClaudeInputBox(STARSHIP)).toBe(false)
    expect(claudeOnScreen(POWERSHELL)).toBe(false)
  })

  it('still counts a working Claude', () => {
    expect(claudeOnScreen('✻ Thinking… (3s · esc to interrupt)\n' + IDLE_CLAUDE)).toBe(true)
  })
})

describe('unknownProcessLabel: close guard when the OS cannot name the process (I2)', () => {
  it('asks for an idle Claude', () => {
    expect(unknownProcessLabel(IDLE_CLAUDE, false)).toBe('claude')
  })

  it('asks for a full-screen program on the alternate buffer', () => {
    expect(unknownProcessLabel('~\n~\n', true)).not.toBeNull()
  })

  it('does not ask at a plain prompt or in an empty pane', () => {
    expect(unknownProcessLabel(POWERSHELL, false)).toBeNull()
    expect(unknownProcessLabel('C:\\proj>', false)).toBeNull()
    expect(unknownProcessLabel(STARSHIP, false)).toBeNull()
    expect(unknownProcessLabel('\n\n\n', false)).toBeNull()
  })

  it('asks when a program is producing output (last line is not a prompt)', () => {
    expect(unknownProcessLabel('PS C:\\proj> npm run build\nbuilding 41%', false)).not.toBeNull()
  })
})

describe('claudeIsForeground: strict, fail-closed gate for typing into a pane', () => {
  const shell = (n: string): boolean => ['zsh', 'bash'].includes(n)
  it('is true only for a non-shell process with Claude on screen', () => {
    expect(claudeIsForeground('claude', IDLE_CLAUDE, shell)).toBe(true)
    expect(claudeIsForeground('node', IDLE_CLAUDE, shell)).toBe(true)
  })
  it('is false when the foreground is a shell, even with Claude text left in the scrollback', () => {
    expect(claudeIsForeground('zsh', IDLE_CLAUDE, shell)).toBe(false)
  })
  it('is false for python, vim, ssh, sudo: a non-shell process without Claude on screen', () => {
    for (const p of ['python3', 'vim', 'ssh', 'sudo']) expect(claudeIsForeground(p, POWERSHELL, shell)).toBe(false)
    expect(claudeIsForeground('python3', '>>> print(1)\n1\n>>> ', shell)).toBe(false)
  })
  it('is false when the process is unknown (null), and follows the screen where the OS cannot tell', () => {
    expect(claudeIsForeground(null, IDLE_CLAUDE, shell)).toBe(false)
    expect(claudeIsForeground('', IDLE_CLAUDE, shell)).toBe(true)
    expect(claudeIsForeground('', POWERSHELL, shell)).toBe(false)
  })
})
