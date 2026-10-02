import { describe, expect, it } from 'vitest'
import { parseQuickQuery, matchToken, scorePath, highlightPositions, charMask } from '@shared/search/fuzzy'

describe('parseQuickQuery', () => {
  it('splits tokens and lowercases', () => {
    expect(parseQuickQuery('  Foo Bar ').tokens).toEqual(['foo', 'bar'])
  })
  it('reads a :line and :line:col suffix', () => {
    const q = parseQuickQuery('app.tsx:42:7')
    expect(q.tokens).toEqual(['app.tsx'])
    expect(q.line).toBe(42)
    expect(q.col).toBe(7)
  })
  it('reads a #line suffix and never returns line 0', () => {
    expect(parseQuickQuery('a#0').line).toBe(1)
  })
  it('collects *.ext filters out of the tokens', () => {
    const q = parseQuickQuery('*.TSX button')
    expect(q.exts).toEqual(['tsx'])
    expect(q.tokens).toEqual(['button'])
  })
  it('normalizes backslashes to slashes', () => {
    expect(parseQuickQuery('src\\main').tokens).toEqual(['src/main'])
  })
})

describe('scorePath', () => {
  const score = (q: string, p: string): number => {
    const parsed = parseQuickQuery(q)
    return scorePath(parsed.tokens, p.toLowerCase(), p)
  }
  it('rejects paths that do not contain the letters in order', () => {
    expect(score('zzz', 'src/app.ts')).toBeLessThan(0)
    expect(score('ba', 'ab')).toBeLessThan(0)
  })
  it('a file name match beats the same match in a folder name', () => {
    expect(score('util', 'src/util.ts')).toBeGreaterThan(score('util', 'util/index.ts'))
  })
  it('a basename substring beats a basename subsequence', () => {
    expect(score('btn', 'a/btn.ts')).toBeGreaterThan(score('btn', 'a/button.ts'))
  })
  it('shorter paths win ties', () => {
    expect(score('app', 'app.ts')).toBeGreaterThan(score('app', 'a/b/c/d/app.ts'))
  })
  it('all tokens must match', () => {
    expect(score('src button', 'src/components/Button.tsx')).toBeGreaterThan(0)
    expect(score('lib button', 'src/components/Button.tsx')).toBeLessThan(0)
  })
  it('a token with a slash matches against the path', () => {
    expect(score('components/but', 'src/components/Button.tsx')).toBeGreaterThan(0)
  })
})

describe('matchToken and highlight', () => {
  it('reports matched positions inside the path', () => {
    const p = 'src/Button.tsx'
    const pos = highlightPositions(['button'], p)
    expect(pos.map((i) => p[i]).join('').toLowerCase()).toBe('button')
  })
  it('returns -1 for no match', () => {
    expect(matchToken('xyz', 'abc', 'abc', 0)).toBe(-1)
  })
  it('charMask is a subset test', () => {
    const need = charMask('abc')
    const have = charMask('xxabcyy')
    expect((need & have) === need).toBe(true)
    expect((charMask('abq') & have) === charMask('abq')).toBe(false)
  })
})
