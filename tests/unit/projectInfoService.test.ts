import { describe, it, expect } from 'vitest'
import { safeUrl } from '@main/services/projectInfoService'

describe('safeUrl', () => {
  it('strips a token embedded as the username', () => {
    expect(safeUrl('https://ghp_abc123@github.com/org/repo.git')).toBe(
      'https://github.com/org/repo.git'
    )
  })

  it('strips a user:password pair', () => {
    expect(safeUrl('https://user:secret@example.com/repo.git')).toBe(
      'https://example.com/repo.git'
    )
  })

  it('leaves a plain https remote untouched', () => {
    expect(safeUrl('https://github.com/org/repo.git')).toBe('https://github.com/org/repo.git')
  })

  it('leaves an SSH remote untouched (git@ is not a credential)', () => {
    expect(safeUrl('git@github.com:org/repo.git')).toBe('git@github.com:org/repo.git')
  })

  it('falls back to the raw string for anything unparseable', () => {
    expect(safeUrl('not a url at all')).toBe('not a url at all')
  })
})
