import { describe, it, expect } from 'vitest'
import {
  applyCompletion,
  BUILTIN_COMMANDS,
  detectTrigger,
  escapeIntent,
  fuzzyScore,
  isComposingKey,
  mergeCommands,
  rankFuzzy
} from '../../src/renderer/src/components/chat/composerTriggers'
import {
  IDLE_NAV,
  mergeHistory,
  pushHistory,
  shouldRecall,
  stepHistory
} from '../../src/renderer/src/components/chat/promptHistory'

describe('detectTrigger', () => {
  it('finds a slash command at the start of the input', () => {
    expect(detectTrigger('/com', 4)).toEqual({ kind: 'slash', query: 'com', start: 0, end: 4 })
    expect(detectTrigger('hi\n/mo', 6)).toBeNull() // M6: a slash command only counts at the start of the input
  })
  it('ignores a slash in the middle of a line or after a space', () => {
    expect(detectTrigger('a /com', 6)).toBeNull()
    expect(detectTrigger('/com mand', 9)).toBeNull()
    expect(detectTrigger('src/a', 5)).toBeNull()
  })
  it('finds an @ token after whitespace or at line start', () => {
    expect(detectTrigger('look at @src/ma', 15)).toEqual({ kind: 'at', query: 'src/ma', start: 8, end: 15 })
    expect(detectTrigger('@x', 2)).toEqual({ kind: 'at', query: 'x', start: 0, end: 2 })
    expect(detectTrigger('a\n@b', 4)).toEqual({ kind: 'at', query: 'b', start: 2, end: 4 })
    expect(detectTrigger('@', 1)).toEqual({ kind: 'at', query: '', start: 0, end: 1 })
  })
  it('ignores an @ inside a word (email)', () => {
    expect(detectTrigger('me@site.com', 11)).toBeNull()
  })
  it('only looks before the caret', () => {
    expect(detectTrigger('@abc def', 2)).toEqual({ kind: 'at', query: 'a', start: 0, end: 2 })
  })
})

describe('applyCompletion', () => {
  it('replaces the trigger and keeps the rest', () => {
    const t = detectTrigger('open @sr and more', 8)!
    expect(applyCompletion('open @sr and more', t, '@src/a.ts ')).toEqual({
      value: 'open @src/a.ts  and more',
      caret: 15
    })
  })
})

describe('fuzzy ranking', () => {
  it('prefers prefix, then word-start, then subsequence', () => {
    const items = ['/compact', '/commit-push', '/my-comp', '/cost']
    expect(rankFuzzy(items, 'com', (s) => s).slice(0, 3)).toEqual(['/compact', '/commit-push', '/my-comp'])
  })
  it('drops non-matches and returns all for an empty query', () => {
    expect(rankFuzzy(['a', 'b'], 'z', (s) => s)).toEqual([])
    expect(rankFuzzy(['a', 'b'], '', (s) => s)).toEqual(['a', 'b'])
  })
  it('matches a scattered subsequence for file paths', () => {
    expect(fuzzyScore('cmp', 'src/components/Composer.tsx')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'src/a.ts')).toBe(-1)
  })
  it('lists the built-ins asked for in the brief', () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    for (const n of ['/clear', '/compact', '/model', '/resume', '/review', '/voice', '/cost', '/help', '/init', '/memory', '/agents', '/mcp']) {
      expect(names).toContain(n)
    }
  })
  it('merges skills without duplicating a built-in', () => {
    const out = mergeCommands([
      { slashName: 'deploy', description: 'd', source: 'command' },
      { slashName: '/clear', description: 'x', source: 'skill' }
    ])
    expect(out.filter((c) => c.name === '/clear')).toHaveLength(1)
    expect(out.at(-1)).toEqual({ name: '/deploy', description: 'd', source: 'command' })
  })
})

describe('prompt history', () => {
  it('pushes newest last, skips blanks and consecutive duplicates, caps at 100', () => {
    let h: string[] = []
    h = pushHistory(h, ' a ')
    h = pushHistory(h, 'a')
    h = pushHistory(h, '   ')
    h = pushHistory(h, 'b')
    expect(h).toEqual(['a', 'b'])
    for (let i = 0; i < 150; i++) h = pushHistory(h, `p${i}`)
    expect(h).toHaveLength(100)
    expect(h.at(-1)).toBe('p149')
  })
  it('merges transcript then memory, dedupes keeping the latest', () => {
    expect(mergeHistory(['a', 'b', 'c'], ['b', 'd'])).toEqual(['a', 'c', 'b', 'd'])
  })
  it('recalls on empty input or caret at start; Down only while browsing at the end', () => {
    expect(shouldRecall('up', '', 0, 0, IDLE_NAV)).toBe(true)
    expect(shouldRecall('up', 'text', 0, 0, IDLE_NAV)).toBe(true)
    expect(shouldRecall('up', 'text', 2, 2, IDLE_NAV)).toBe(false)
    expect(shouldRecall('up', 'text', 0, 4, IDLE_NAV)).toBe(false)
    expect(shouldRecall('down', 'text', 4, 4, IDLE_NAV)).toBe(false)
    expect(shouldRecall('down', 'text', 4, 4, { index: 0, stash: '' })).toBe(true)
    expect(shouldRecall('down', 'a\nb', 0, 0, { index: 0, stash: '' })).toBe(false)
    expect(shouldRecall('down', 'a\nb', 3, 3, { index: 0, stash: '' })).toBe(true)
    expect(shouldRecall('up', 'a\nb', 3, 3, { index: 0, stash: '' })).toBe(false)
    expect(shouldRecall('up', 'ab', 2, 2, { index: 0, stash: '' })).toBe(true)
  })
  it('walks back through history and forward again, restoring the stash', () => {
    const list = ['one', 'two', 'three']
    let r = stepHistory(list, IDLE_NAV, 'up', 'draft')
    expect(r.text).toBe('three')
    r = stepHistory(list, r.nav, 'up', 'three')
    expect(r.text).toBe('two')
    r = stepHistory(list, r.nav, 'up', 'two')
    expect(r.text).toBe('one')
    r = stepHistory(list, r.nav, 'up', 'one')
    expect(r.text).toBeNull()
    r = stepHistory(list, r.nav, 'down', 'one')
    expect(r.text).toBe('two')
    r = stepHistory(list, r.nav, 'down', 'two')
    expect(r.text).toBe('three')
    r = stepHistory(list, r.nav, 'down', 'three')
    expect(r.text).toBe('draft')
    expect(r.nav).toEqual(IDLE_NAV)
    expect(stepHistory(list, IDLE_NAV, 'down', 'x').text).toBeNull()
    expect(stepHistory([], IDLE_NAV, 'up', 'x').text).toBeNull()
  })
})

describe('isComposingKey', () => {
  it('is true while composing or for keyCode 229', () => {
    expect(isComposingKey({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isComposingKey({ isComposing: false, keyCode: 229 })).toBe(true)
    expect(isComposingKey({ isComposing: false, keyCode: 13 })).toBe(false)
    expect(isComposingKey({})).toBe(false)
  })
})

describe('escapeIntent (Opus I1)', () => {
  it('Esc with a live @ trigger dismisses the popup instead of interrupting Claude', () => {
    const t = detectTrigger('look at @', 9)
    expect(t).not.toBeNull()
    expect(escapeIntent({ voiceActive: false, triggerActive: t !== null })).toBe('dismiss-popup')
  })
  it('recording wins, and with nothing to dismiss Esc interrupts', () => {
    expect(escapeIntent({ voiceActive: true, triggerActive: true })).toBe('cancel-voice')
    expect(escapeIntent({ voiceActive: false, triggerActive: false })).toBe('interrupt')
  })
})
