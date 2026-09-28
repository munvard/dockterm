import { describe, it, expect } from 'vitest'
import {
  findPathLinks,
  columnForStringIndex,
  type CellSpan
} from '@renderer/components/terminal/pathLinks'

describe('findPathLinks', () => {
  it('finds a relative path with a code extension', () => {
    const links = findPathLinks('Update(src/rateLimit.ts) +28 lines')
    expect(links.map((l) => l.path)).toContain('src/rateLimit.ts')
  })
  it('captures a :line suffix', () => {
    const l = findPathLinks('error at src/server.ts:42')[0]
    expect(l.path).toBe('src/server.ts')
    expect(l.line).toBe(42)
    expect(l.length).toBe('src/server.ts:42'.length)
  })
  it('handles ./ and bare filenames', () => {
    expect(findPathLinks('see ./README.md and package.json').map((l) => l.path)).toEqual([
      './README.md',
      'package.json'
    ])
  })
  it('ignores version numbers and domains', () => {
    expect(findPathLinks('v1.2.0 released at example.com today')).toHaveLength(0)
  })
  it('ignores paths inside a URL', () => {
    expect(findPathLinks('https://example.com/app/main.js')).toHaveLength(0)
  })
  it('reports the correct index', () => {
    const text = 'edit foo/bar.tsx now'
    const l = findPathLinks(text)[0]
    expect(text.slice(l.index, l.index + l.length)).toBe('foo/bar.tsx')
  })

  it('matches a Windows absolute path with backslashes', () => {
    const links = findPathLinks('open C:\\Users\\taron\\proj\\app.ts now')
    expect(links.map((l) => l.path)).toContain('C:\\Users\\taron\\proj\\app.ts')
  })

  it('matches a Windows absolute path with forward slashes', () => {
    const links = findPathLinks('open C:/Users/taron/proj/app.ts now')
    expect(links.map((l) => l.path)).toContain('C:/Users/taron/proj/app.ts')
  })

  it('matches a bare relative Windows path with backslashes', () => {
    const links = findPathLinks('changed: src\\index.ts')
    expect(links.map((l) => l.path)).toContain('src\\index.ts')
  })

  it('still ignores a URL scheme like https: as a drive letter', () => {
    expect(findPathLinks('see https://example.com/app/main.js')).toHaveLength(0)
  })

  it('captures :line:col after a Windows path', () => {
    const l = findPathLinks('error at C:\\proj\\app.ts:10:5')[0]
    expect(l.path).toBe('C:\\proj\\app.ts')
    expect(l.line).toBe(10)
  })
})

describe('columnForStringIndex', () => {
  const cell = (chars: string, width = 1): CellSpan => ({ chars, width })

  it('is the identity mapping when every cell is width 1', () => {
    // "abc.ts" — one cell per char, all width 1.
    const cells = [...'abc.ts'].map((c) => cell(c))
    expect(columnForStringIndex(cells, 0)).toBe(0)
    expect(columnForStringIndex(cells, 3)).toBe(3)
    expect(columnForStringIndex(cells, 6)).toBe(6)
  })

  it('shifts the column by the extra width of an earlier wide character', () => {
    // A CJK char (width 2, one JS string char) before the path: "中" + "a.ts".
    // String indices: 0='中', 1='a', 2='.', 3='t', 4='s'.
    const cells = [cell('中', 2), cell('a'), cell('.'), cell('t'), cell('s')]
    // "a.ts" starts at string index 1, but occupies terminal column 2 (the
    // wide char took columns 0-1) — the bug this fixes was reporting column 1.
    expect(columnForStringIndex(cells, 1)).toBe(2)
    expect(columnForStringIndex(cells, 5)).toBe(6) // end of "a.ts"
  })

  it('handles two wide characters before the match', () => {
    const cells = [cell('中', 2), cell('文', 2), cell('x'), cell('.'), cell('t'), cell('s')]
    // "x.ts" starts at string index 2, terminal column 4.
    expect(columnForStringIndex(cells, 2)).toBe(4)
  })
})
