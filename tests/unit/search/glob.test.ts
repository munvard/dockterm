import { describe, expect, it } from 'vitest'
import { compileGlobs, splitGlobList, globToRegExpSource } from '@shared/search/glob'

describe('splitGlobList', () => {
  it('splits on commas and trims', () => {
    expect(splitGlobList('*.ts, *.tsx ,docs')).toEqual(['*.ts', '*.tsx', 'docs'])
  })
  it('keeps commas inside braces', () => {
    expect(splitGlobList('*.{ts,tsx},lib')).toEqual(['*.{ts,tsx}', 'lib'])
  })
  it('returns nothing for blank input', () => {
    expect(splitGlobList('  ,  ')).toEqual([])
  })
})

describe('compileGlobs', () => {
  it('is null for an empty list', () => {
    expect(compileGlobs('')).toBeNull()
  })
  it('a glob without a slash matches a name at any depth', () => {
    const g = compileGlobs('*.ts')!
    expect(g.test('a.ts')).toBe(true)
    expect(g.test('src/deep/a.ts')).toBe(true)
    expect(g.test('src/a.tsx')).toBe(false)
  })
  it('a folder name matches everything below it', () => {
    const g = compileGlobs('node_modules')!
    expect(g.test('a/node_modules/x/y.js')).toBe(true)
    expect(g.test('a/b.js')).toBe(false)
  })
  it('a glob with a slash is anchored at the root', () => {
    const g = compileGlobs('src/**/*.ts')!
    expect(g.test('src/a/b.ts')).toBe(true)
    expect(g.test('lib/src/a.ts')).toBe(false)
  })
  it('an anchored folder also matches below it', () => {
    const g = compileGlobs('src/main')!
    expect(g.test('src/main/x/y.ts')).toBe(true)
    expect(g.test('src/renderer/y.ts')).toBe(false)
  })
  it('supports braces, ? and sets', () => {
    expect(compileGlobs('*.{js,mjs}')!.test('a.mjs')).toBe(true)
    expect(compileGlobs('a?.txt')!.test('ab.txt')).toBe(true)
    expect(compileGlobs('[ab].txt')!.test('c.txt')).toBe(false)
  })
  it('turns an invalid glob into a matcher that matches nothing instead of throwing', () => {
    expect(() => globToRegExpSource('[')).not.toThrow()
    const g = compileGlobs('[')
    if (g) expect(g.test('a')).toBe(false)
  })
})
