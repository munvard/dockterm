import { describe, expect, it } from 'vitest'
import { PathIndex, F_DIR, F_IGNORED } from '@shared/search/pathIndex'

const make = (paths: Array<string | [string, number]>, max?: number): PathIndex => {
  const ix = new PathIndex(max)
  for (const p of paths) {
    if (typeof p === 'string') ix.add(p, 0)
    else ix.add(p[0], p[1])
  }
  return ix
}
const names = (ix: PathIndex, q: string, o: Partial<Parameters<PathIndex['query']>[1]> = {}): string[] =>
  ix.query(q, { includeIgnored: false, kinds: 'files', limit: 100, ...o }).hits.map((h) => h.relPath)

describe('PathIndex', () => {
  it('finds by fuzzy file name, best first', () => {
    const ix = make(['button/other.ts', 'src/components/Button.tsx', 'README.md'])
    const r = names(ix, 'button')
    expect(r[0]).toBe('src/components/Button.tsx')
    expect(r).toContain('button/other.ts')
    expect(r).not.toContain('README.md')
  })
  it('hides ignored entries unless asked', () => {
    const ix = make(['a.ts', ['node_modules/pkg/index.js', F_IGNORED], ['node_modules', F_DIR | F_IGNORED]])
    expect(names(ix, 'index')).toEqual([])
    expect(names(ix, 'index', { includeIgnored: true })).toEqual(['node_modules/pkg/index.js'])
  })
  it('files only by default, folders with kinds both', () => {
    const ix = make([['src', F_DIR], 'src/a.ts'])
    expect(names(ix, 'src', { kinds: 'files' })).toEqual(['src/a.ts'])
    expect(names(ix, 'src', { kinds: 'both' })).toContain('src')
  })
  it('extension filter and line suffix', () => {
    const ix = make(['a.ts', 'a.tsx', 'b.css'])
    expect(names(ix, '*.tsx')).toEqual(['a.tsx'])
    const r = ix.query('a.ts:12', { includeIgnored: false, kinds: 'files', limit: 10 })
    expect(r.line).toBe(12)
    expect(r.hits[0].relPath).toBe('a.ts')
  })
  it('boosts recently opened files', () => {
    const ix = make(['one/util.ts', 'two/util.ts'])
    const first = names(ix, 'util', { recent: ['two/util.ts'] })
    expect(first[0]).toBe('two/util.ts')
  })
  it('caps the page and reports the total', () => {
    const ix = make(Array.from({ length: 50 }, (_, i) => `f${i}.ts`))
    const r = ix.query('f', { includeIgnored: false, kinds: 'files', limit: 5 })
    expect(r.hits).toHaveLength(5)
    expect(r.total).toBe(50)
  })
  it('removal and removeTree', () => {
    const ix = make([['d', F_DIR], 'd/a.ts', 'd/b.ts', 'e.ts'])
    ix.remove('e.ts')
    expect(names(ix, 'e.ts')).toEqual([])
    expect(ix.removeTree('d')).toBe(3)
    expect(ix.size).toBe(0)
  })
  it('compacts after many removals and keeps answering correctly', () => {
    const ix = new PathIndex()
    for (let i = 0; i < 1000; i++) ix.add(`dir/file${i}.ts`, 0)
    for (let i = 0; i < 900; i++) ix.remove(`dir/file${i}.ts`)
    expect(ix.size).toBe(100)
    expect(names(ix, 'file950')).toEqual(['dir/file950.ts'])
    expect(names(ix, 'file100.ts')).toEqual([])
  })
  it('stops at the cap and says so', () => {
    const ix = make(['a', 'b', 'c', 'd'], 3)
    expect(ix.size).toBe(3)
    expect(ix.truncated).toBe(true)
  })
  it('re-adding updates flags instead of duplicating', () => {
    const ix = make(['a.ts'])
    ix.add('a.ts', F_IGNORED)
    expect(ix.size).toBe(1)
    expect(names(ix, 'a.ts')).toEqual([])
  })
})

describe('PathIndex scattered-match cutoff', () => {
  const strong = Array.from({ length: 60 }, (_, i) => `src/co${i}.ts`)
  const scattered = Array.from({ length: 60 }, (_, i) => `components/very/long/folder/name/number${i}/other.ts`)

  it('keeps the same hits and flags the total as a lower bound once the page is full of strong matches', () => {
    const full = make([...strong, ...scattered])
    const small = full.query('co', { includeIgnored: false, kinds: 'files', limit: 20 })
    expect(small.hits.every((h) => h.relPath.startsWith('src/co'))).toBe(true)
    expect(small.totalApprox).toBe(true)
    const noPage = make(strong).query('co', { includeIgnored: false, kinds: 'files', limit: 100 })
    expect(noPage.totalApprox).toBeUndefined()
    expect(noPage.total).toBe(60)
  })

  it('counts scattered matches exactly while the page is not full', () => {
    const r = make([...strong.slice(0, 3), 'a/c/x/o.ts']).query('co', { includeIgnored: false, kinds: 'files', limit: 100 })
    expect(r.totalApprox).toBeUndefined()
    expect(r.total).toBe(4)
  })
})
