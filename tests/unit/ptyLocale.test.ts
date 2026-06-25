import { describe, it, expect } from 'vitest'
import { ensureUtf8Locale } from '../../src/main/services/ptyLocale'

describe('ensureUtf8Locale', () => {
  it('sets LC_CTYPE=UTF-8 on macOS when no locale is present (Finder-launch case)', () => {
    const env = ensureUtf8Locale({ TERM: 'xterm-256color' }, 'darwin')
    expect(env.LC_CTYPE).toBe('UTF-8')
  })

  it('leaves an existing UTF-8 LANG alone on macOS', () => {
    const env = ensureUtf8Locale({ LANG: 'en_US.UTF-8' }, 'darwin')
    expect(env.LC_CTYPE).toBeUndefined()
  })

  it('leaves an existing UTF-8 LC_CTYPE alone', () => {
    const env = ensureUtf8Locale({ LC_CTYPE: 'UTF-8' }, 'darwin')
    expect(env.LC_CTYPE).toBe('UTF-8')
  })

  it('respects a UTF-8 LC_ALL on macOS', () => {
    const env = ensureUtf8Locale({ LC_ALL: 'en_US.UTF-8' }, 'darwin')
    expect(env.LC_CTYPE).toBeUndefined()
  })

  it('does not touch non-darwin platforms', () => {
    expect(ensureUtf8Locale({}, 'linux').LC_CTYPE).toBeUndefined()
    expect(ensureUtf8Locale({}, 'win32').LC_CTYPE).toBeUndefined()
  })

  it('recognises utf8 written without a hyphen', () => {
    const env = ensureUtf8Locale({ LANG: 'C.utf8' }, 'darwin')
    expect(env.LC_CTYPE).toBeUndefined()
  })
})
