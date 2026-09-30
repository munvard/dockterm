import { win32, posix } from 'node:path'

/** Claude Code's folder name for a project: every non-alphanumeric char becomes '-'. */
export const slugFor = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

/** NTFS is case-insensitive and Windows accepts either slash, so every path
 * compare in transcript discovery goes through this fold. Other platforms
 * compare exactly. `platform` is a parameter so the logic is testable anywhere. */
export function foldPath(p: string, platform: string): string {
  if (platform !== 'win32') return p
  return p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function samePath(a: string, b: string, platform: string): boolean {
  return foldPath(a, platform) === foldPath(b, platform)
}

/** True when transcript `file` sits directly inside `dir`. */
export function isDirectChild(file: string, dir: string, platform: string): boolean {
  const p = platform === 'win32' ? win32 : posix
  const f = platform === 'win32' ? file.replace(/\//g, '\\') : file
  return samePath(p.dirname(f), dir, platform)
}

/** Pick the on-disk entry of `names` that is the project folder for `slug`. An
 * exact match wins; on Windows a case-only difference (`d--x` vs `D--x`, the
 * drive letter of the pane cwd vs the one Claude recorded) still matches. */
export function pickProjectDir(names: string[], slug: string, platform: string): string | null {
  if (names.includes(slug)) return slug
  if (platform !== 'win32') return null
  const low = slug.toLowerCase()
  return names.find((n) => n.toLowerCase() === low) ?? null
}

/** Upper-case a leading Windows drive letter (`d:\x` -> `D:\x`). */
export function upperDrive(p: string, platform: string): string {
  if (platform !== 'win32') return p
  return p.replace(/^([a-z]):/, (_m, d: string) => `${d.toUpperCase()}:`)
}

/** Text a Claude TUI puts in front of a line (prompt marker, bullet, box border). */
const TUI_PREFIX = /^[\s│┃❯>⏺●⎿·•*-]+/

/** A terminal line as it would appear in the transcript text: the TUI's own
 * leading glyphs removed, so `❯ Reply with exactly: hi` matches the prompt. */
export function stripTuiPrefix(line: string): string {
  return line.replace(TUI_PREFIX, '').trim()
}

/**
 * Choose a transcript from per-file fingerprint hits (newest first). Two hits
 * make a confident match (the newest best wins). A single hit is enough only
 * when it is unambiguous: exactly one transcript has any hit. A short first
 * exchange shows too few distinctive lines for two hits.
 */
export function pickByHits(hits: { path: string; n: number }[], minHits: number): string | null {
  let best: string | null = null
  let bestN = minHits - 1
  for (const h of hits) {
    if (h.n > bestN) {
      bestN = h.n
      best = h.path
    }
  }
  if (best) return best
  const any = hits.filter((h) => h.n >= 1)
  return any.length === 1 ? any[0].path : null
}
