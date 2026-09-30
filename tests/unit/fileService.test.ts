import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync, writeFileSync, readdirSync, statSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile, rename, createFile, splitRelPath, isCaseOnlyChange } from '@main/services/fileService'

let root: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-fileservice-')))
})

afterAll(() => {
  // best-effort cleanup of the last root; each test uses a fresh tmpdir anyway
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // ignore
  }
})

describe('readFile', () => {
  it('reads valid UTF-8 text', async () => {
    writeFileSync(join(root, 'a.txt'), 'hello, world')
    const result = await readFile(root, 'a.txt')
    expect(result.kind).toBe('text')
    if (result.kind === 'text') expect(result.content).toBe('hello, world')
  })

  it('treats invalid UTF-8 (e.g. Latin-1 text) as binary instead of corrupting it', async () => {
    // 0xE9 alone ("é" in Latin-1) is not a valid UTF-8 sequence on its own.
    const buf = Buffer.from([0x68, 0x69, 0xe9, 0x21])
    writeFileSync(join(root, 'latin1.txt'), buf)
    const result = await readFile(root, 'latin1.txt')
    expect(result.kind).toBe('binary')
  })

  it('still detects null-byte binary files', async () => {
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0, 1, 2, 3]))
    const result = await readFile(root, 'bin.dat')
    expect(result.kind).toBe('binary')
  })
})

describe('writeFile', () => {
  it('writes content and never leaves a temp sibling behind', async () => {
    await createFile(root, 'a.txt')
    const result = await writeFile(root, 'a.txt', 'new content', null)
    expect(result.kind).toBe('ok')
    const read = await readFile(root, 'a.txt')
    expect(read.kind).toBe('text')
    if (read.kind === 'text') expect(read.content).toBe('new content')
    const leftovers = readdirSync(root).filter((n) => n.includes('dockterm-tmp'))
    expect(leftovers).toEqual([])
  })

  it('reports a conflict when the file changed since it was read', async () => {
    await createFile(root, 'a.txt')
    const stale = -1 // never matches a real mtimeMs
    const result = await writeFile(root, 'a.txt', 'x', stale)
    expect(result.kind).toBe('conflict')
  })
})

describe('rename', () => {
  it('refuses to overwrite an existing destination', async () => {
    await createFile(root, 'a.txt')
    await createFile(root, 'b.txt')
    await expect(rename(root, 'a.txt', 'b.txt')).rejects.toThrow(/already exists/)
    // both files must still be present, untouched
    expect(existsSync(join(root, 'a.txt'))).toBe(true)
    expect(existsSync(join(root, 'b.txt'))).toBe(true)
  })

  it('allows renaming to a free destination', async () => {
    await createFile(root, 'a.txt')
    await rename(root, 'a.txt', 'c.txt')
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
    expect(existsSync(join(root, 'c.txt'))).toBe(true)
  })
})

describe('rename: case-only changes (Codex 10)', () => {
  it('splitRelPath keeps the requested spelling and rejects bad names', () => {
    expect(splitRelPath('foo.txt')).toEqual({ parent: '', name: 'foo.txt' })
    expect(splitRelPath('src/Sub/foo.txt')).toEqual({ parent: 'src/Sub', name: 'foo.txt' })
    expect(splitRelPath('src\\Foo.txt')).toEqual({ parent: 'src', name: 'Foo.txt' })
    expect(() => splitRelPath('a/..')).toThrow()
    expect(() => splitRelPath('')).toThrow()
  })

  it('isCaseOnlyChange is true only for a pure case change', () => {
    expect(isCaseOnlyChange('Foo.txt', 'foo.txt')).toBe(true)
    expect(isCaseOnlyChange('foo.txt', 'foo.txt')).toBe(false)
    expect(isCaseOnlyChange('foo.txt', 'bar.txt')).toBe(false)
  })

  it('renames Foo.txt to foo.txt so the new spelling is on disk', async () => {
    await createFile(root, 'Foo.txt')
    await rename(root, 'Foo.txt', 'foo.txt')
    expect(readdirSync(root)).toEqual(['foo.txt'])
  })

  it('does the same inside a subfolder and for a folder', async () => {
    mkdirSync(join(root, 'sub'))
    mkdirSync(join(root, 'sub', 'Dir'))
    await rename(root, 'sub/Dir', 'sub/dir')
    expect(readdirSync(join(root, 'sub'))).toEqual(['dir'])
  })

  it('leaves no temporary sibling behind', async () => {
    await createFile(root, 'Foo.txt')
    await rename(root, 'Foo.txt', 'FOO.txt')
    expect(readdirSync(root)).toEqual(['FOO.txt'])
  })

  it('still refuses a different existing file that differs only by case', async () => {
    await createFile(root, 'Foo.txt')
    await createFile(root, 'other.txt')
    await expect(rename(root, 'other.txt', 'foo.txt')).rejects.toThrow(/already exists|ENOENT/)
    expect(existsSync(join(root, 'other.txt'))).toBe(true)
  })

  it('renaming to the same name is a no-op', async () => {
    await createFile(root, 'a.txt')
    await rename(root, 'a.txt', 'a.txt')
    expect(readdirSync(root)).toEqual(['a.txt'])
  })
})

describe.skipIf(process.platform === 'win32')('writeFile keeps file permissions', () => {
  it('keeps an executable script executable after a save', async () => {
    const p = join(root, 'run.sh')
    writeFileSync(p, '#!/bin/sh\necho hi\n')
    chmodSync(p, 0o755)
    await writeFile(root, 'run.sh', '#!/bin/sh\necho bye\n', null)
    expect(statSync(p).mode & 0o777).toBe(0o755)
    expect(readFileSync(p, 'utf8')).toBe('#!/bin/sh\necho bye\n')
  })

  it('refuses to overwrite a read-only file', async () => {
    const p = join(root, 'locked.txt')
    writeFileSync(p, 'keep me')
    chmodSync(p, 0o444)
    await expect(writeFile(root, 'locked.txt', 'changed', null)).rejects.toThrow()
    expect(readFileSync(p, 'utf8')).toBe('keep me')
    chmodSync(p, 0o644)
  })
})
