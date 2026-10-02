import { describe, expect, it } from 'vitest'
import {
  buildMatcher,
  searchText,
  clipLine,
  looksBinary,
  hasBinaryExtension,
  MAX_LINE_FOR_MATCH
} from '@shared/search/lineSearch'

const opts = { query: 'foo', caseSensitive: false, wholeWord: false, regex: false }
const find = (text: string, o = opts, max = 100) => {
  const m = buildMatcher(o)
  if (!m.ok) throw new Error(m.error)
  return searchText(text, m.re, max)
}

describe('buildMatcher', () => {
  it('rejects an empty query and a bad regex without throwing', () => {
    expect(buildMatcher({ ...opts, query: '' }).ok).toBe(false)
    const bad = buildMatcher({ ...opts, query: '(', regex: true })
    expect(bad.ok).toBe(false)
  })
  it('escapes a literal query', () => {
    const r = find('a.c\nabc', { ...opts, query: 'a.c' })
    expect(r.totalLines).toBe(1)
  })
})

describe('searchText', () => {
  it('finds lines with 1-based numbers and ranges', () => {
    const r = find('one\nxx foo yy FOO\nthree')
    expect(r.totalLines).toBe(1)
    expect(r.matches[0].line).toBe(2)
    expect(r.matches[0].ranges).toEqual([[3, 6], [10, 13]])
  })
  it('respects case sensitivity', () => {
    expect(find('Foo', { ...opts, caseSensitive: true }).totalLines).toBe(0)
    expect(find('Foo').totalLines).toBe(1)
  })
  it('whole word does not match inside a word', () => {
    const o = { ...opts, wholeWord: true }
    expect(find('foobar', o).totalLines).toBe(0)
    expect(find('a foo.b', o).totalLines).toBe(1)
    expect(find('foo_x', o).totalLines).toBe(0)
  })
  it('regex mode', () => {
    expect(find('abc123', { ...opts, query: '\\d+', regex: true }).matches[0].ranges).toEqual([[3, 6]])
  })
  it('counts every matching line but stores only maxLines', () => {
    const text = Array.from({ length: 10 }, () => 'foo').join('\n')
    const r = find(text, opts, 3)
    expect(r.totalLines).toBe(10)
    expect(r.matches).toHaveLength(3)
  })
  it('handles CRLF without a stray carriage return', () => {
    const r = find('a foo\r\nb')
    expect(r.matches[0].text.endsWith('\r')).toBe(false)
  })
  it('does not hang on a zero-width regex', () => {
    const r = find('abc', { ...opts, query: 'x*', regex: true })
    expect(r.totalLines).toBeGreaterThanOrEqual(0)
  })
  it('skips absurdly long lines', () => {
    const r = find('foo' + 'x'.repeat(MAX_LINE_FOR_MATCH + 5))
    expect(r.totalLines).toBe(0)
  })
})

describe('clipLine', () => {
  it('keeps short lines whole', () => {
    expect(clipLine('hello', [[0, 5]])).toEqual({ text: 'hello', ranges: [[0, 5]] })
  })
  it('clips long lines around the first match and shifts ranges', () => {
    const line = 'x'.repeat(500) + 'NEEDLE' + 'y'.repeat(500)
    const c = clipLine(line, [[500, 506]])
    expect(c.text.length).toBeLessThan(400)
    expect(c.text.slice(c.ranges[0][0], c.ranges[0][1])).toBe('NEEDLE')
  })
})

describe('binary detection', () => {
  it('a NUL byte means binary', () => {
    expect(looksBinary(new Uint8Array([104, 105, 0, 1]))).toBe(true)
    expect(looksBinary(new TextEncoder().encode('plain text'))).toBe(false)
  })
  it('known binary extensions', () => {
    expect(hasBinaryExtension('a/b.PNG')).toBe(true)
    expect(hasBinaryExtension('a/b.ts')).toBe(false)
  })
})
