import { describe, it, expect } from 'vitest'
import { parseClaudeInputBox } from '@renderer/components/terminal/claudeInputBox'

const RULE = '─'.repeat(100)
const screen = (...box: string[]): string =>
  ['  ⏺ earlier answer', '', RULE, ...box, RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n')

describe('parseClaudeInputBox (F3)', () => {
  it('reads a single-line draft', () => {
    expect(parseClaudeInputBox(screen('❯ Write a markdown table.'))).toBe('Write a markdown table.')
    expect(parseClaudeInputBox(screen('> hello'))).toBe('hello')
  })

  it('reads a draft that wraps onto continuation lines', () => {
    expect(parseClaudeInputBox(screen('❯ first part of a long draft that', '  wraps onto a second line', '  and a third'))).toBe(
      'first part of a long draft that\nwraps onto a second line\nand a third'
    )
  })

  it('an empty box is empty, with or without the trailing space', () => {
    expect(parseClaudeInputBox(screen('❯ '))).toBe('')
    expect(parseClaudeInputBox(screen('❯'))).toBe('')
  })

  it('the dim Try "..." hint is not text', () => {
    expect(parseClaudeInputBox(screen('❯ Try "how does auth.ts work?"'))).toBe('')
  })

  it('reads the older framed box', () => {
    const framed = ['╭' + '─'.repeat(60) + '╮', '│ > old style draft                                          │', '╰' + '─'.repeat(60) + '╯'].join('\n')
    expect(parseClaudeInputBox(framed)).toBe('old style draft')
  })

  it('uses the bottom-most box and ignores rules with no prompt line', () => {
    const s = ['❯ old prompt echoed above', RULE, '  some dialog text', RULE, RULE, '❯ live draft', RULE].join('\n')
    expect(parseClaudeInputBox(s)).toBe('live draft')
  })

  it('returns null when there is no box (shell, dialog, blank)', () => {
    expect(parseClaudeInputBox('PS C:\\proj> ')).toBeNull()
    expect(parseClaudeInputBox('')).toBeNull()
    expect(parseClaudeInputBox(['❯ starship', '~/x'].join('\n'))).toBeNull()
  })
})
