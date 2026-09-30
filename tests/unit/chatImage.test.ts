import { describe, it, expect, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  writeFileSync,
  utimesSync,
  existsSync,
  readFileSync,
  symlinkSync,
  statSync,
  mkdirSync,
  chmodSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_IMAGE_BYTES,
  IMAGE_TTL_MS,
  saveImageSchema,
  validateImage,
  selectStale,
  writeImage,
  sweepOldImages,
  ensurePrivateDir,
  randomImageName,
  extForMime
} from '../../src/main/services/chatImageCore'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'dt-img-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('validateImage', () => {
  it('accepts the four mimes within the size limit', () => {
    for (const m of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
      expect(validateImage(m, 10)).toBeNull()
    }
  })
  it('rejects other mimes, empty and oversized data', () => {
    expect(validateImage('image/svg+xml', 10)).toMatch(/Unsupported/)
    expect(validateImage('application/pdf', 10)).toMatch(/Unsupported/)
    expect(validateImage('image/png', 0)).toMatch(/Empty/)
    expect(validateImage('image/png', MAX_IMAGE_BYTES)).toBeNull()
    expect(validateImage('image/png', MAX_IMAGE_BYTES + 1)).toMatch(/20 MB/)
  })
})

describe('saveImageSchema', () => {
  it('parses base64 and bytes, rejects a bad mime', () => {
    expect(saveImageSchema.safeParse({ data: 'aGk=', mime: 'image/png' }).success).toBe(true)
    expect(saveImageSchema.safeParse({ data: new Uint8Array([1, 2]), mime: 'image/webp' }).success).toBe(true)
    expect(saveImageSchema.safeParse({ data: 'aGk=', mime: 'image/bmp' }).success).toBe(false)
    expect(saveImageSchema.safeParse({ data: 5, mime: 'image/png' }).success).toBe(false)
  })
})

describe('selectStale', () => {
  it('picks only files older than the ttl', () => {
    const now = 10 * IMAGE_TTL_MS
    const out = selectStale(
      [
        { name: 'old.png', mtimeMs: now - IMAGE_TTL_MS - 1 },
        { name: 'edge.png', mtimeMs: now - IMAGE_TTL_MS },
        { name: 'new.png', mtimeMs: now - 1000 }
      ],
      now
    )
    expect(out).toEqual(['old.png'])
  })
})

describe('writeImage / sweepOldImages', () => {
  it('writes into the dir with a random name and the right extension', () => {
    const dir = join(tmp(), 'dockterm-images')
    const p = writeImage(dir, Buffer.from('hello').toString('base64'), 'image/jpeg')
    expect(p.startsWith(dir)).toBe(true)
    expect(p).toMatch(/[0-9a-f]{24}\.jpg$/)
    expect(readFileSync(p, 'utf8')).toBe('hello')
    const q = writeImage(dir, new Uint8Array([1, 2, 3]), 'image/png')
    expect(q).not.toBe(p)
    expect(readdirSync(dir)).toHaveLength(2)
  })
  it('refuses oversized or empty data', () => {
    const dir = tmp()
    expect(() => writeImage(dir, new Uint8Array(0), 'image/png')).toThrow()
    expect(() => writeImage(dir, new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png')).toThrow(/20 MB/)
    expect(readdirSync(dir)).toHaveLength(0)
  })
  it('sweeps only stale files and tolerates a missing dir', () => {
    const dir = tmp()
    const old = join(dir, 'a.png')
    const fresh = join(dir, 'b.png')
    writeFileSync(old, 'x')
    writeFileSync(fresh, 'y')
    const eightDays = (Date.now() - 8 * 24 * 3600 * 1000) / 1000
    utimesSync(old, eightDays, eightDays)
    expect(sweepOldImages(dir)).toBe(1)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect(sweepOldImages(join(dir, 'nope'))).toBe(0)
  })
  it('names never repeat and follow the mime', () => {
    expect(randomImageName('image/gif')).toMatch(/\.gif$/)
    expect(randomImageName('image/png')).not.toBe(randomImageName('image/png'))
    expect(extForMime('image/webp')).toBe('webp')
  })
})

describe('temp image dir safety', () => {
  // NTFS has no POSIX permission bits: statSync().mode there is 0o666 or 0o777, whatever chmod asks for.
  it.skipIf(process.platform === 'win32')('creates the dir private (0700) and tightens a loose one we own', () => {
    const dir = join(tmp(), 'dockterm-images')
    writeImage(dir, new Uint8Array([1]), 'image/png')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    chmodSync(dir, 0o755)
    writeImage(dir, new Uint8Array([1]), 'image/png')
    expect(statSync(dir).mode & 0o777).toBe(0o700)
  })
  it('refuses to write through a symlinked dir', () => {
    const root = tmp()
    const target = join(root, 'target')
    mkdirSync(target)
    const link = join(root, 'dockterm-images')
    symlinkSync(target, link)
    expect(() => writeImage(link, new Uint8Array([1]), 'image/png')).toThrow(/plain directory/)
    expect(readdirSync(target)).toHaveLength(0)
  })
  it('refuses a dir owned by someone else', () => {
    const dir = join(tmp(), 'dockterm-images')
    mkdirSync(dir)
    expect(() => ensurePrivateDir(dir, (statSync(dir).uid ?? 0) + 1)).toThrow(/another user/)
  })
  it('sweep does not enter a symlinked dir or delete what it points to', () => {
    const root = tmp()
    const target = join(root, 'target')
    mkdirSync(target)
    const victim = join(target, 'victim.png')
    writeFileSync(victim, 'x')
    const old = (Date.now() - 30 * 24 * 3600 * 1000) / 1000
    utimesSync(victim, old, old)
    const link = join(root, 'dockterm-images')
    symlinkSync(target, link)
    expect(sweepOldImages(link)).toBe(0)
    expect(existsSync(victim)).toBe(true)
  })
  it('sweep skips symlink entries and subdirectories, leaving link targets alone', () => {
    const root = tmp()
    const dir = join(root, 'dockterm-images')
    mkdirSync(dir)
    const outside = join(root, 'outside.png')
    writeFileSync(outside, 'x')
    const old = (Date.now() - 30 * 24 * 3600 * 1000) / 1000
    utimesSync(outside, old, old)
    symlinkSync(outside, join(dir, 'link.png'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'deep.png'), 'x')
    utimesSync(join(dir, 'sub', 'deep.png'), old, old)
    const stale = join(dir, 'stale.png')
    writeFileSync(stale, 'x')
    utimesSync(stale, old, old)
    expect(sweepOldImages(dir)).toBe(1)
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(outside)).toBe(true)
    expect(existsSync(join(dir, 'sub', 'deep.png'))).toBe(true)
    expect(existsSync(join(dir, 'link.png'))).toBe(true)
  })
  it('never overwrites an existing file (exclusive create)', () => {
    const dir = join(tmp(), 'dockterm-images')
    const names = new Set<string>()
    for (let i = 0; i < 20; i++) names.add(writeImage(dir, new Uint8Array([i + 1]), 'image/png'))
    expect(names.size).toBe(20)
  })
})
