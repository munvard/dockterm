import { randomBytes } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** Pure (no electron) core of the chat-image temp store, so it is unit-testable. */

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const IMAGE_DIR_NAME = 'dockterm-images'

const EXT: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export const saveImageSchema = z.object({
  // base64 text (4/3 of the bytes) or raw bytes; the exact size is re-checked after decoding.
  data: z.union([
    z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8),
    z.instanceof(Uint8Array).refine((b) => b.byteLength <= MAX_IMAGE_BYTES, 'Image is larger than 20 MB')
  ]),
  mime: z.enum(IMAGE_MIMES)
})
export type SaveImageReq = z.infer<typeof saveImageSchema>

export function extForMime(mime: ImageMime): string {
  return EXT[mime]
}

/** null when fine, else a short reason. */
export function validateImage(mime: string, byteLength: number): string | null {
  if (!(IMAGE_MIMES as readonly string[]).includes(mime)) return 'Unsupported image type'
  if (byteLength <= 0) return 'Empty image'
  if (byteLength > MAX_IMAGE_BYTES) return 'Image is larger than 20 MB'
  return null
}

export function decodeImageData(data: string | Uint8Array): Buffer {
  return typeof data === 'string'
    ? Buffer.from(data, 'base64')
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength) // a view, not a second copy
}

/** A random file name (never derived from clipboard content). */
export function randomImageName(mime: ImageMime): string {
  return `${randomBytes(12).toString('hex')}.${EXT[mime]}`
}

/** Names of files whose mtime is older than `maxAgeMs` at `now`. */
export function selectStale(
  entries: { name: string; mtimeMs: number }[],
  now: number,
  maxAgeMs: number = IMAGE_TTL_MS
): string[] {
  return entries.filter((e) => now - e.mtimeMs > maxAgeMs).map((e) => e.name)
}

/** This process's user id, or null where the platform has none (Windows). */
function currentUid(): number | null {
  return typeof process.getuid === 'function' ? process.getuid() : null
}

/**
 * Make sure `dir` is a real directory (never a symlink) owned by this user and
 * private (0700). The temp folder is shared with other local users, so a
 * pre-planted symlink or a foreign-owned folder would let them redirect our
 * writes and deletes. Throws when it cannot be trusted.
 */
export function ensurePrivateDir(dir: string, uid: number | null = currentUid()): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = lstatSync(dir)
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error('The image folder is not a plain directory')
  if (uid !== null && st.uid !== uid) throw new Error('The image folder belongs to another user')
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) chmodSync(dir, 0o700)
}

/** Write the bytes into `dir` (a private dir we own) under a random name, exclusively. Returns the absolute path. */
export function writeImage(dir: string, data: string | Uint8Array, mime: ImageMime): string {
  const buf = decodeImageData(data)
  const bad = validateImage(mime, buf.byteLength)
  if (bad) throw new Error(bad)
  ensurePrivateDir(dir)
  const path = join(dir, randomImageName(mime))
  writeFileSync(path, buf, { flag: 'wx', mode: 0o600 })
  return path
}

/**
 * Delete regular files older than the TTL directly inside `dir`. Never follows
 * a link: `lstat` sees a symlink as a link (skipped), and a symlinked or
 * foreign `dir` is refused outright. Missing dir or unreadable file is fine.
 */
export function sweepOldImages(dir: string, now: number = Date.now(), uid: number | null = currentUid()): number {
  let names: string[]
  try {
    const st = lstatSync(dir)
    if (st.isSymbolicLink() || !st.isDirectory()) return 0
    if (uid !== null && st.uid !== uid) return 0
    names = readdirSync(dir)
  } catch {
    return 0
  }
  const entries: { name: string; mtimeMs: number }[] = []
  for (const name of names) {
    try {
      const st = lstatSync(join(dir, name))
      if (st.isFile()) entries.push({ name, mtimeMs: st.mtimeMs })
    } catch {
      // vanished meanwhile
    }
  }
  let removed = 0
  for (const name of selectStale(entries, now)) {
    try {
      unlinkSync(join(dir, name))
      removed++
    } catch {
      // ignore
    }
  }
  return removed
}
