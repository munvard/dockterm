import { describe, it, expect } from 'vitest'
import { classify, parseAsk } from '@renderer/components/terminal/claudeStatus'

describe('classify', () => {
  it('detects working from the token-counter spinner line', () => {
    expect(classify('✻ Thinking… (12s · 1.2k tokens)')).toBe('working')
  })
  it('detects working from "esc to interrupt"', () => {
    expect(classify('Running tool (esc to interrupt)')).toBe('working')
  })
  it('detects asking from a numbered prompt menu', () => {
    expect(classify('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe('asking')
  })
  it('detects asking inside a box-drawing border', () => {
    expect(classify('│ ❯ 1. Yes │\n│   2. No  │')).toBe('asking')
  })
  it('detects asking from "Esc to cancel"', () => {
    expect(classify('Enter to confirm · Esc to cancel')).toBe('asking')
  })
  it('returns idle for ordinary output', () => {
    expect(classify('$ ls\nREADME.md\n$ ')).toBe('idle')
  })
})

describe('parseAsk', () => {
  it('parses a boxed yes/no proceed prompt as binary with a clean title', () => {
    const text = [
      '╭───────────────────────────────╮',
      '│ Bash command                  │',
      '│   npm install                 │',
      '│ Do you want to proceed?       │',
      '│ ❯ 1. Yes                      │',
      "│   2. Yes, and don't ask again │",
      '│   3. No, and tell Claude      │',
      '╰───────────────────────────────╯'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.binary).toBe(true)
    expect(ask.options[0]).toMatch(/^Yes/)
    expect(ask.title).toContain('npm install')
    expect(ask.title).not.toContain('─')
  })

  it('treats a non-yes/no menu as a choice (not binary)', () => {
    const text = [
      'Restore which checkpoint?',
      '❯ 1. 5 minutes ago',
      '  2. 1 hour ago',
      '  3. yesterday'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.binary).toBe(false)
    expect(ask.options).toHaveLength(3)
  })

  it('treats a free-text "Esc to cancel" prompt as non-binary with no options', () => {
    const ask = parseAsk('Type your answer · Esc to cancel')!
    expect(ask.binary).toBe(false)
    expect(ask.options).toHaveLength(0)
  })

  it('marks an ordinary numbered menu as non-multi-select', () => {
    const ask = parseAsk('Restore which checkpoint?\n❯ 1. a\n  2. b')!
    expect(ask.multiSelect).toBe(false)
    expect(ask.submitIndex).toBeNull()
    expect(ask.checkable).toEqual([false, false])
  })

  it('parses a checkbox multi-select prompt with a Submit row', () => {
    const text = [
      'Pick any of these (multi-select).',
      '❯ 1. [ ] Option A',
      '  2. [x] Option B',
      '  Submit',
      '  3. [ ] Type something'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(true)
    expect(ask.binary).toBe(false)
    expect(ask.options).toEqual(['Option A', 'Option B', 'Submit', 'Type something'])
    expect(ask.checkable).toEqual([true, true, false, true])
    expect(ask.checked).toEqual([false, true, false, false])
    expect(ask.submitIndex).toBe(2)
  })

  it('treats the post-submit review screen as a plain single-select', () => {
    // Claude's confirm screen echoes "(multi select)" but is really Submit/Cancel.
    const text = [
      'Review your answers',
      'Pick any number of options (multi select):',
      'Ready to submit your answers?',
      '❯ 1. Submit answers',
      '  2. Cancel',
      'Enter to select · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(false)
    expect(ask.options).toEqual(['Submit answers', 'Cancel'])
    expect(ask.submitIndex).toBeNull()
  })

  it('parses a multi-step wizard: breadcrumb, options + descriptions', () => {
    const text = [
      '☐ Focus area  ☐ Change type  ✔ Submit',
      'Which area should we focus on?',
      '❯ 1. Lighting (Sonoff 4CH)',
      '   Work with your ~17 Sonoff switches.',
      '  2. Climate (DeLonghi)',
      '   Focus on the DeLonghi machines.',
      'Enter to select · Tab/Arrow keys to navigate · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(false)
    expect(ask.steps.map((s) => s.label)).toEqual(['Focus area', 'Change type', 'Submit'])
    expect(ask.steps[2].done).toBe(true)
    expect(ask.options).toEqual(['Lighting (Sonoff 4CH)', 'Climate (DeLonghi)'])
    expect(ask.descriptions[0]).toContain('Sonoff')
    expect(ask.title).toContain('Which area')
  })

  it('reports the cursor row from the ❯ marker', () => {
    const ask = parseAsk('Pick one:\n  1. a\n❯ 2. b\n  3. c')!
    expect(ask.cursorRow).toBe(1)
  })

  it('ignores an echoed numbered prompt list above the real menu (only the last run counts)', () => {
    // Reproduces the bug: the user's prompt ("1. … 2. … 3. … 4. …") is still on
    // screen above Claude's actual Yes/No menu. Only the trailing menu is real.
    const text = [
      '> For testing interactive questions only. Do not edit any files.',
      '',
      'Ask me these prompts one by one:',
      '',
      '1. Permission question: ask a yes/no question: "Do you want to continue this test?"',
      '2. Single-choice question: ask me to choose exactly 1 option from 5 options:',
      '',
      '    * Option A',
      '    * Option B',
      '3. Multi-choice question: ask me to choose multiple options from the same 5 options.',
      '4. Two-stage question flow:',
      '',
      "● I'll run through these one by one. Starting with the first.",
      '────────────────────────────',
      '□ Continue?',
      '',
      'Do you want to continue this test?',
      '',
      '❯ 1. Yes',
      '    Proceed with the remaining test questions.',
      '  2. No',
      '    Stop the test here.',
      '  3. Type something.',
      '────────────────────────────',
      '  4. Chat about this',
      '',
      'Enter to select · ↑/↓ to navigate · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.options).toEqual(['Yes', 'No', 'Type something.', 'Chat about this'])
    expect(ask.binary).toBe(true)
    expect(ask.cursorRow).toBe(0)
    expect(ask.title).toContain('continue this test')
  })

  it('keeps the full 5-option menu even when an echoed 4-item list is on screen', () => {
    const text = [
      '1. First question.',
      '2. Second question.',
      '3. Third question.',
      '4. Fourth question.',
      '',
      'Pick exactly one option:',
      '',
      '❯ 1. Option A',
      '  2. Option B',
      '  3. Option C',
      '  4. Option D',
      '  5. Option E',
      'Enter to select · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.options).toEqual(['Option A', 'Option B', 'Option C', 'Option D', 'Option E'])
    expect(ask.binary).toBe(false)
  })

  it('parses the live checkbox prompt: descriptions, Submit, and a trailing action row', () => {
    const text = [
      'Choose one or more options. (Tool max is 4 buttons.)',
      '❯ 1. [ ] Option A',
      '    The first option.',
      '  2. [✓] Option B',
      '    The second option.',
      '  3. [ ] Option C',
      '    The third option.',
      '  4. [ ] Option D',
      '    The fourth option.',
      '  5. [ ] Type something',
      '    Submit',
      '  6. Chat about this',
      'Enter to select · ↑/↓ to navigate · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(true)
    expect(ask.options).toEqual([
      'Option A',
      'Option B',
      'Option C',
      'Option D',
      'Type something',
      'Submit',
      'Chat about this'
    ])
    expect(ask.checkable).toEqual([true, true, true, true, true, false, false])
    expect(ask.checked).toEqual([false, true, false, false, false, false, false])
    expect(ask.submitIndex).toBe(5)
  })

  it('switches to a clean Submit/Cancel single-select once the checkbox menu scrolls behind a review screen', () => {
    // After answering a checkbox prompt, Claude shows a Submit/Cancel review while
    // the just-answered checkbox menu is still in the scrollback above it. munu
    // must read the review (no phantom checkboxes) — not stay stuck rendering the
    // multi-select for the seconds it takes the old menu to scroll away.
    const text = [
      'Question 2 answered: Option B. Now the multi-choice question.',
      '❯ 1. [ ] Option A',
      '    The first option.',
      '  2. [✓] Option B',
      '    The second option.',
      '  3. [ ] Option C',
      '  4. [ ] Option D',
      '  5. [ ] Type something',
      '    Submit',
      '  6. Chat about this',
      '',
      'Review your answers',
      '  → Option B',
      'Ready to submit your answers?',
      '❯ 1. Submit answers',
      '  2. Cancel',
      'Enter to select · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(false)
    expect(ask.options).toEqual(['Submit answers', 'Cancel'])
    expect(ask.checkable).toEqual([false, false])
    expect(ask.submitIndex).toBeNull()
    expect(ask.cursorRow).toBe(0)
  })

  it('drops an echoed list before a checkbox multi-select menu', () => {
    const text = [
      '1. Some earlier instruction.',
      '2. Another earlier instruction.',
      'Choose any of these (multi-select):',
      '❯ 1. [ ] Red',
      '  2. [x] Green',
      '  3. [ ] Blue',
      '  Submit',
      'Enter to confirm · Esc to cancel'
    ].join('\n')
    const ask = parseAsk(text)!
    expect(ask.multiSelect).toBe(true)
    expect(ask.options).toEqual(['Red', 'Green', 'Blue', 'Submit'])
    expect(ask.checked).toEqual([false, true, false, false])
    expect(ask.submitIndex).toBe(3)
  })

  it('returns null when not asking', () => {
    expect(parseAsk('just output')).toBeNull()
  })
})
