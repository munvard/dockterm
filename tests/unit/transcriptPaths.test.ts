import { describe, it, expect } from 'vitest'
import {
  slugFor,
  foldPath,
  samePath,
  isDirectChild,
  pickProjectDir,
  upperDrive,
  stripTuiPrefix,
  pickByHits
} from '../../src/main/services/transcriptPaths'

describe('transcript path compares (F1)', () => {
  it('slugFor matches Claude folder naming', () => {
    expect(slugFor('D:\\dt-build\\testproj')).toBe('D--dt-build-testproj')
    expect(slugFor('/Users/me/proj')).toBe('-Users-me-proj')
  })

  it('win32: drive-letter case and slash style do not matter', () => {
    expect(samePath('d:\\dt-build\\testproj', 'D:/dt-build/testproj/', 'win32')).toBe(true)
    expect(foldPath('D:/X/Y/', 'win32')).toBe('d:\\x\\y')
  })

  it('posix: compares stay case-sensitive', () => {
    expect(samePath('/a/B', '/a/b', 'linux')).toBe(false)
    expect(samePath('/a/b', '/a/b', 'darwin')).toBe(true)
  })

  it('win32: a transcript in the Claude folder with a different drive case is a child', () => {
    const dir = 'C:\\Users\\me\\.claude\\projects\\d--dt-build-testproj'
    const file = 'C:\\Users\\me\\.claude\\projects\\D--dt-build-testproj\\abc.jsonl'
    expect(isDirectChild(file, dir, 'win32')).toBe(true)
    expect(isDirectChild(file, dir, 'linux')).toBe(false)
    expect(isDirectChild('C:/Users/me/.claude/projects/D--dt-build-testproj/abc.jsonl', dir, 'win32')).toBe(true)
  })

  it('pickProjectDir finds the folder despite drive-letter case on win32 only', () => {
    const names = ['D--dt-build-testproj', 'C--other']
    expect(pickProjectDir(names, 'd--dt-build-testproj', 'win32')).toBe('D--dt-build-testproj')
    expect(pickProjectDir(names, 'd--dt-build-testproj', 'linux')).toBeNull()
    expect(pickProjectDir(names, 'C--other', 'linux')).toBe('C--other')
  })

  it('upperDrive only touches a win32 drive letter', () => {
    expect(upperDrive('d:\\dt-build', 'win32')).toBe('D:\\dt-build')
    expect(upperDrive('D:\\x', 'win32')).toBe('D:\\x')
    expect(upperDrive('d:\\dt-build', 'linux')).toBe('d:\\dt-build')
    expect(upperDrive('/usr/x', 'win32')).toBe('/usr/x')
  })
})

describe('fingerprint helpers', () => {
  it('strips the TUI prompt and bullet glyphs', () => {
    expect(stripTuiPrefix('❯ Reply with exactly: hi')).toBe('Reply with exactly: hi')
    expect(stripTuiPrefix('⏺ Here is the table')).toBe('Here is the table')
    expect(stripTuiPrefix('│ > hello there world │'.replace(/ │$/, ''))).toBe('hello there world')
    expect(stripTuiPrefix('plain text line')).toBe('plain text line')
  })

  it('two hits win; a single hit only when unambiguous', () => {
    expect(pickByHits([{ path: 'a', n: 1 }, { path: 'b', n: 2 }], 2)).toBe('b')
    expect(pickByHits([{ path: 'a', n: 1 }, { path: 'b', n: 0 }], 2)).toBe('a')
    expect(pickByHits([{ path: 'a', n: 1 }, { path: 'b', n: 1 }], 2)).toBeNull()
    expect(pickByHits([{ path: 'a', n: 0 }], 2)).toBeNull()
  })
})
