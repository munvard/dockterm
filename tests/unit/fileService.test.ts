import { mkdtempSync, rmSync, realpathSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile, rename, createFile } from '@main/services/fileService'

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
