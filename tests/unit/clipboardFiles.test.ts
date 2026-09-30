import { describe, it, expect } from 'vitest'
import {
  parseUriList,
  parseNSFilenames,
  parseFileNameW,
  keepExistingAbsolute
} from '../../src/main/services/clipboardFilesCore'

describe('parseUriList', () => {
  // These URLs are POSIX paths; on Windows fileURLToPath rejects a URL with no drive letter,
  // so the win32 twin below covers the same behaviour with drive paths.
  const posixOnly = process.platform === 'win32'
  it.skipIf(posixOnly)('decodes file URLs, skips comments and non-file lines', () => {
    const text = '# comment\r\nfile:///home/me/My%20Doc.png\r\nhttps://x.y/z\r\nfile:///tmp/a.txt\n'
    expect(parseUriList(text)).toEqual(['/home/me/My Doc.png', '/tmp/a.txt'])
  })
  it.skipIf(!posixOnly)('decodes file URLs with drive letters on Windows', () => {
    const text = '# comment\r\nfile:///C:/Users/me/My%20Doc.png\r\nhttps://x.y/z\r\nfile:///D:/tmp/a.txt\n'
    expect(parseUriList(text)).toEqual(['C:\\Users\\me\\My Doc.png', 'D:\\tmp\\a.txt'])
  })
  it.skipIf(posixOnly)('handles the gnome copied-files layout', () => {
    expect(parseUriList('copy\nfile:///tmp/a.txt\nfile:///tmp/b.txt')).toEqual(['/tmp/a.txt', '/tmp/b.txt'])
  })
  it('returns empty for plain text', () => {
    expect(parseUriList('hello world')).toEqual([])
  })
})

describe('parseNSFilenames', () => {
  it('reads every string from the plist and unescapes XML', () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><array>
<string>/Users/me/a &amp; b.png</string>
<string>/Users/me/dir</string></array></plist>`
    expect(parseNSFilenames(xml)).toEqual(['/Users/me/a & b.png', '/Users/me/dir'])
  })
  it('returns empty when there are no strings', () => {
    expect(parseNSFilenames('')).toEqual([])
  })
})

describe('parseFileNameW', () => {
  it('reads a UTF-16LE NUL-terminated path (single and list)', () => {
    const one = Buffer.from('C:\\Users\\me\\a b.png\0', 'utf16le')
    expect(parseFileNameW(one)).toEqual(['C:\\Users\\me\\a b.png'])
    const many = Buffer.from('C:\\a.png\0D:\\b.png\0\0', 'utf16le')
    expect(parseFileNameW(many)).toEqual(['C:\\a.png', 'D:\\b.png'])
  })
})

describe('keepExistingAbsolute', () => {
  it('keeps only absolute, existing, unique paths', () => {
    const have = new Set(['/a/x.png', '/a/y'])
    const out = keepExistingAbsolute(['/a/x.png', 'rel/z', '/a/gone', '/a/x.png', '/a/y', ''], (p) => have.has(p))
    expect(out).toEqual(['/a/x.png', '/a/y'])
  })
  it('treats a throwing exists() as missing', () => {
    expect(
      keepExistingAbsolute(['/a'], () => {
        throw new Error('EACCES')
      })
    ).toEqual([])
  })
})

import { classifyPaths } from '../../src/main/services/clipboardFilesCore'

describe('classifyPaths', () => {
  it('flags folders, drops relative and unreadable paths', () => {
    const dirs = new Set(['/a/dir'])
    const files = new Set(['/a/x.png'])
    const stat = (p: string): { isDirectory(): boolean } => {
      if (!dirs.has(p) && !files.has(p)) throw new Error('ENOENT')
      return { isDirectory: () => dirs.has(p) }
    }
    expect(classifyPaths(['/a/x.png', '/a/dir', 'rel', '/a/missing'], stat)).toEqual([
      { path: '/a/x.png', isDir: false },
      { path: '/a/dir', isDir: true }
    ])
  })
})
