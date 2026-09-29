import { describe, it, expect } from 'vitest'
import {
  clearInputKeys,
  detectVoiceStatus,
  parseInputBox,
  voiceInsertion
} from '../../src/renderer/src/components/chat/claudeVoice'

const RULE = '─'.repeat(100)
// Shapes captured from Claude Code 2.1.284 in a headless PTY (2026-09-29).
const screen = (box: string[], above: string[] = []): string =>
  [
    ' ▐▛███▛█   Claude Code v2.1.284',
    '▝▜██████▀  Opus 5.5 with high effort · Claude Max',
    ' ▝▝   ▝▝   ~/dockterm',
    ...above,
    '',
    RULE,
    ...box,
    RULE,
    '  ⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker · restart with CLAUDE_C…',
    '  ◆ Opus 5.5 high | ctx 0K | $0.00 | dockterm ⎇ feat/reading-comfort-zen ●',
    '  ⏵⏵ auto mode on (shift+tab to cycle)'
  ].join('\n')

describe('detectVoiceStatus', () => {
  it('idle on an ordinary screen', () => {
    expect(detectVoiceStatus(screen(['❯']))).toBe('idle')
    expect(detectVoiceStatus('')).toBe('idle')
  })

  it('warming, listening, processing (hold mode)', () => {
    expect(detectVoiceStatus(screen(['❯'], ['  keep holding…']))).toBe('warming')
    expect(detectVoiceStatus(screen(['❯ hello wor'], ['  listening…']))).toBe('listening')
    expect(detectVoiceStatus(screen(['❯ hello world'], ['  Voice: processing…']))).toBe('processing')
  })

  it('rec (tap mode)', () => {
    expect(detectVoiceStatus(screen(['❯'], ['  ● REC · tap to send']))).toBe('rec')
    expect(detectVoiceStatus(screen(['❯'], [' REC']))).toBe('rec')
  })

  it('processing beats listening when both linger on screen', () => {
    expect(detectVoiceStatus(screen(['❯'], ['listening…', 'Voice: processing…']))).toBe('processing')
  })

  it('accepts three ASCII dots for the ellipsis', () => {
    expect(detectVoiceStatus(screen(['❯'], ['listening...']))).toBe('listening')
  })

  it('does not match words inside other words', () => {
    expect(detectVoiceStatus(screen(['❯ RECORD the demo']))).toBe('idle')
    expect(detectVoiceStatus(screen(['❯ PRECISE']))).toBe('idle')
  })

  it('ignores a mention far above the bottom of the screen', () => {
    const chatter = ['Claude said: listening…', ...Array.from({ length: 30 }, (_, i) => `line ${i}`)]
    expect(detectVoiceStatus(chatter.join('\n') + '\n' + screen(['❯']))).toBe('idle')
  })
})

describe('parseInputBox', () => {
  it('empty box', () => {
    expect(parseInputBox(screen(['❯']))).toEqual({ text: '', lineCount: 1 })
    expect(parseInputBox(screen(['❯ ']))).toEqual({ text: '', lineCount: 1 })
  })

  it('one line', () => {
    expect(parseInputBox(screen(['❯ hello world']))).toEqual({ text: 'hello world', lineCount: 1 })
  })

  it('continuation rows are indented two spaces and joined with a space', () => {
    expect(parseInputBox(screen(['❯ hello worldline one', '  line two', '  line three']))).toEqual({
      text: 'hello worldline one line two line three',
      lineCount: 3
    })
  })

  it('the dim placeholder is empty text', () => {
    expect(parseInputBox(screen(['❯ Try "fix lint errors"']))).toEqual({ text: '', lineCount: 1 })
    expect(parseInputBox(screen(['❯ Try “refactor foo”']))).toEqual({ text: '', lineCount: 1 })
  })

  it('a real prompt that only starts with Try is kept', () => {
    expect(parseInputBox(screen(['❯ Try the second approach']))?.text).toBe('Try the second approach')
  })

  it('uses the LAST box when an older one is still on screen', () => {
    const old = [RULE, '❯ older prompt', RULE]
    expect(parseInputBox(screen(['❯ current'], old))?.text).toBe('current')
  })

  it('skips a permission menu row', () => {
    const menu = [RULE, ' Do you want to proceed?', '❯ 1. Yes', '  2. No', RULE].join('\n')
    expect(parseInputBox(menu)).toBeNull()
  })

  it('null when there is no box or it is cut off', () => {
    expect(parseInputBox('just some text\nmore')).toBeNull()
    expect(parseInputBox([RULE, '❯ hi'].join('\n'))).toBeNull()
  })
})

describe('clearInputKeys', () => {
  it('is Ctrl+U x (lines + 2)', () => {
    expect(clearInputKeys(1)).toBe('\x15\x15\x15')
    expect(clearInputKeys(3)).toBe('\x15'.repeat(5))
    expect(clearInputKeys(0)).toBe('\x15\x15\x15')
  })
})

describe('voiceInsertion', () => {
  it('adds a leading space only when text touches the caret', () => {
    expect(voiceInsertion('', 0, 0, 'hello')).toBe('hello')
    expect(voiceInsertion('fix', 3, 3, 'the bug')).toBe(' the bug')
    expect(voiceInsertion('fix ', 4, 4, 'the bug')).toBe('the bug')
    expect(voiceInsertion('fix\n', 4, 4, 'the bug')).toBe('the bug')
  })

  it('adds a trailing space when text follows the caret', () => {
    expect(voiceInsertion('ab', 1, 1, 'X')).toBe(' X ')
    expect(voiceInsertion('a b', 2, 2, 'X')).toBe('X ')
  })

  it('an empty transcript inserts nothing', () => {
    expect(voiceInsertion('abc', 1, 1, '  ')).toBe('')
  })
})
