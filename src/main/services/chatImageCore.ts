import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
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
  data: z.union([z.string().max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8), z.instanceof(Uint8Array)]),
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
  return typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data)
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

/** Write the bytes into `dir` (created private) under a random name. Returns the absolute path. */
export function writeImage(dir: string, data: string | Uint8Array, mime: ImageMime): string {
  const buf = decodeImageData(data)
  const bad = validateImage(mime, buf.byteLength)
  if (bad) throw new Error(bad)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, randomImageName(mime))
  writeFileSync(path, buf, { flag: 'wx', mode: 0o600 })
  return path
}

/** Delete files older than the TTL in `dir`. Missing dir or unreadable file is fine. */
export function sweepOldImages(dir: string, now: number = Date.now()): number {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  const entries: { name: string; mtimeMs: number }[] = []
  for (const name of names) {
    try {
      const st = statSync(join(dir, name))
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
