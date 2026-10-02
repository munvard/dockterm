import { describe, expect, it } from 'vitest'
import { parseGitignore, isIgnoredBy, type IgnoreScope } from '@shared/search/gitignore'

const scope = (text: string, base = ''): IgnoreScope => ({ base, rules: parseGitignore(text) })

describe('gitignore', () => {
  it('ignores comments and blank lines', () => {
    expect(parseGitignore('# c\n\n  \n')).toHaveLength(0)
  })
  it('a plain name matches at any depth', () => {
    const s = [scope('dist')]
    expect(isIgnoredBy(s, 'dist', true)).toBe(true)
    expect(isIgnoredBy(s, 'a/b/dist', true)).toBe(true)
    expect(isIgnoredBy(s, 'distant.ts', false)).toBe(false)
  })
  it('a trailing slash only matches directories', () => {
    const s = [scope('build/')]
    expect(isIgnoredBy(s, 'build', true)).toBe(true)
    expect(isIgnoredBy(s, 'build', false)).toBe(false)
  })
  it('a leading slash anchors to the scope', () => {
    const s = [scope('/out')]
    expect(isIgnoredBy(s, 'out', true)).toBe(true)
    expect(isIgnoredBy(s, 'a/out', true)).toBe(false)
  })
  it('wildcards and ** work', () => {
    const s = [scope('*.log\ndocs/**/tmp')]
    expect(isIgnoredBy(s, 'a/b.log', false)).toBe(true)
    expect(isIgnoredBy(s, 'docs/x/y/tmp', true)).toBe(true)
    expect(isIgnoredBy(s, 'docs/tmp', true)).toBe(true)
    expect(isIgnoredBy(s, 'other/tmp', true)).toBe(false)
  })
  it('a later negation re-includes', () => {
    const s = [scope('*.env\n!example.env')]
    expect(isIgnoredBy(s, 'prod.env', false)).toBe(true)
    expect(isIgnoredBy(s, 'example.env', false)).toBe(false)
  })
  it('a nested .gitignore only applies below its folder', () => {
    const s = [scope('*.log'), scope('secret.txt', 'pkg')]
    expect(isIgnoredBy(s, 'pkg/secret.txt', false)).toBe(true)
    expect(isIgnoredBy(s, 'secret.txt', false)).toBe(false)
  })
})
