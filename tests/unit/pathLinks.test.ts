import { describe, it, expect } from 'vitest'
import { findPathLinks } from '@renderer/components/terminal/pathLinks'

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
})
