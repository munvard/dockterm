import { describe, it, expect } from 'vitest'
import {
  arrows, isFreeText, pickKeys, submitKeys, textKeys, opensPicker, askSig,
  DOWN, UP, ENTER
} from '../../src/renderer/src/components/terminal/askKeys'
import type { AskInfo } from '../../src/shared/types'

const ask = (over: Partial<AskInfo> = {}): AskInfo => ({
  title: 'Proceed?',
  options: ['Yes', 'No'],
  descriptions: [null, null],
  steps: [],
  binary: true,
  multiSelect: false,
  checkable: [false, false],
  checked: [false, false],
  submitIndex: null,
  cursorRow: 0,
  ...over
})

describe('arrows', () => {
  it('steps down for a later row and up for an earlier one', () => {
    expect(arrows(0, 3)).toEqual([DOWN, DOWN, DOWN])
    expect(arrows(3, 1)).toEqual([UP, UP])
    expect(arrows(2, 2)).toEqual([])
  })
})

describe('isFreeText', () => {
  it('detects rows that open a text field', () => {
    expect(isFreeText('Type something')).toBe(true)
    expect(isFreeText('Other')).toBe(true)
    expect(isFreeText('tell me something else')).toBe(true)
    expect(isFreeText('Yes, allow')).toBe(false)
  })
})

describe('pickKeys', () => {
  it('uses the number key for single-select rows under 9', () => {
    expect(pickKeys(ask(), 0)).toEqual(['1'])
    expect(pickKeys(ask(), 2)).toEqual(['3'])
  })
  it('arrows + enter for row 9 and beyond', () => {
    expect(pickKeys(ask({ cursorRow: 0 }), 9)).toEqual([...arrows(0, 9), ENTER])
  })
  it('always arrows + enter in a multi-select menu', () => {
    expect(pickKeys(ask({ multiSelect: true, cursorRow: 1 }), 3)).toEqual([DOWN, DOWN, ENTER])
  })
})

describe('submitKeys', () => {
  const multi = ask({
    options: ['A', 'B', 'C', 'Submit'],
    multiSelect: true,
    checkable: [true, true, true, false],
    checked: [false, true, false, false],
    submitIndex: 3,
    cursorRow: 0
  })

  it('toggles only the changed boxes, then submits', () => {
    // want A on (was off) and B off (was on); C unchanged
    const keys = submitKeys(multi, new Set([0]))
    expect(keys).toEqual([ENTER, DOWN, ENTER, DOWN, DOWN, ENTER])
  })

  it('submits directly when nothing changed', () => {
    expect(submitKeys(multi, new Set([1]))).toEqual([DOWN, DOWN, DOWN, ENTER])
  })

  it('returns nothing when there is no submit row', () => {
    expect(submitKeys(ask({ multiSelect: true, submitIndex: null }), new Set([0]))).toEqual([])
  })
})

describe('textKeys', () => {
  it('selects the row, types the text, then enter', () => {
    expect(textKeys(ask(), 1, 'hello')).toEqual(['2', 'hello', ENTER])
  })
  it('uses arrows for a multi-select menu', () => {
    expect(textKeys(ask({ multiSelect: true, cursorRow: 0 }), 2, 'hi')).toEqual([DOWN, DOWN, ENTER, 'hi', ENTER])
  })
})

describe('opensPicker', () => {
  it('recognizes slash commands that draw their own TUI', () => {
    for (const c of ['/model', '/tui', '/rewind', '/config', '/agents', '/mcp', '/resume', '/login', '/logout']) {
      expect(opensPicker(c)).toBe(true)
    }
    expect(opensPicker('/model sonnet')).toBe(true)
    expect(opensPicker('  /TUI  ')).toBe(true)
  })
  it('leaves ordinary prompts and other slash commands alone', () => {
    expect(opensPicker('fix the bug in app.ts')).toBe(false)
    expect(opensPicker('/clear')).toBe(false)
    expect(opensPicker('')).toBe(false)
  })
})

describe('askSig', () => {
  it('returns empty string for null', () => {
    expect(askSig(null)).toBe('')
  })

  it('is unchanged when only cursorRow changes (live prompt re-parsing)', () => {
    const base = ask({ title: 'Select files', options: ['File A', 'File B'] })
    const sig1 = askSig(base)
    const sig2 = askSig(ask({ title: 'Select files', options: ['File A', 'File B'], cursorRow: 1 }))
    expect(sig1).toBe(sig2)
  })

  it('is unchanged when only checked changes (live prompt re-parsing)', () => {
    const base = ask({ title: 'Select files', options: ['File A', 'File B'], checked: [false, false] })
    const sig1 = askSig(base)
    const sig2 = askSig(ask({ title: 'Select files', options: ['File A', 'File B'], checked: [true, false] }))
    expect(sig1).toBe(sig2)
  })

  it('changes when the title differs', () => {
    const sig1 = askSig(ask({ title: 'Select files', options: ['File A', 'File B'] }))
    const sig2 = askSig(ask({ title: 'Select folders', options: ['File A', 'File B'] }))
    expect(sig1).not.toBe(sig2)
  })

  it('changes when options differ while count stays the same (stale-state hazard)', () => {
    const sig1 = askSig(ask({ title: 'Select files', options: ['FileA.txt', 'FileB.txt'] }))
    const sig2 = askSig(ask({ title: 'Select files', options: ['FileC.txt', 'FileD.txt'] }))
    expect(sig1).not.toBe(sig2)
  })
})

describe('un-numbered menus', () => {
  it('pick walks the cursor with arrows and Enter instead of a digit', () => {
    expect(pickKeys(ask({ numbered: false, cursorRow: 0 }), 1)).toEqual([DOWN, ENTER])
    expect(pickKeys(ask({ numbered: false, cursorRow: 1 }), 1)).toEqual([ENTER])
  })
  it('free text selects with arrows too', () => {
    const a = ask({ numbered: false, options: ['Yes', 'Type something'], cursorRow: 0 })
    expect(textKeys(a, 1, 'hi')).toEqual([DOWN, ENTER, 'hi', ENTER])
  })
})
