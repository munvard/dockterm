import { describe, it, expect } from 'vitest'
import { matchKey, needleFor } from '../../src/renderer/src/components/terminal/claudeScrollMatch'

describe('claudeScrollTo matching', () => {
  it('reduces text to comparable letters/digits', () => {
    expect(matchKey('  Fix the  Login Bug! ')).toBe('fixtheloginbug')
    expect(matchKey('> can you DEEP-dive?')).toBe('canyoudeepdive')
  })

  it('drops [Image #N] reference markers (added when a screenshot is attached)', () => {
    expect(matchKey('[Image #12] why is this broken')).toBe('whyisthisbroken')
    expect(matchKey('[Image #1][Image #2]hello')).toBe('hello')
  })

  it('is invariant to terminal wrapping / box-drawing chrome around the same prompt', () => {
    const transcript = 'build all seven features now'
    // The same prompt as Claude might render it: a leading marker, wrapped across
    // rows (newlines) and padded — matchKey collapses all of that away.
    const rendered = '│ > build all\nseven   features\nnow │'
    expect(matchKey(rendered).includes(matchKey(transcript))).toBe(true)
  })

  it('needleFor caps length and stays distinctive', () => {
    const n = needleFor('a'.repeat(100))
    expect(n.length).toBe(28)
    expect(needleFor('short')).toBe('short')
  })

  it('needle of a real prompt is found inside its rendered form', () => {
    const preview = 'also can u research and deep ultrathink and tell me'
    const rendered = '  > also can u research and deep ultrathink and tell me can we somehow build'
    expect(matchKey(rendered).includes(needleFor(preview))).toBe(true)
  })
})
