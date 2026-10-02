/**
 * Pure text search for find-in-files: builds a matcher from the user's options
 * and finds matching lines with highlight ranges. No fs, runs in the search workers.
 */

export interface ContentQuery {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

export type MatcherResult = { ok: true; re: RegExp } | { ok: false; error: string }

const WORD_CHAR = '[\\p{L}\\p{N}_]'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the (global, multiline) RegExp for a query. Never throws. */
export function buildMatcher(q: ContentQuery): MatcherResult {
  if (!q.query) return { ok: false, error: 'Empty query' }
  let source = q.regex ? q.query : escapeRegExp(q.query)
  if (q.wholeWord) source = `(?<!${WORD_CHAR})(?:${source})(?!${WORD_CHAR})`
  const flags = `gmu${q.caseSensitive ? '' : 'i'}`
  let re: RegExp
  try {
    re = new RegExp(source, flags)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid pattern' }
  }
  return { ok: true, re }
}

export interface LineMatch {
  /** 1-based line number. */
  line: number
  /** The line text, clipped around the first match when it is long. */
  text: string
  /** [start, end) offsets into `text`. */
  ranges: Array<[number, number]>
}

export interface TextSearchResult {
  matches: LineMatch[]
  /** Every matching line, including those beyond `maxLines`. */
  totalLines: number
}

export const MAX_LINE_FOR_MATCH = 10_000
const CLIP_BEFORE = 60
const CLIP_AFTER = 160

/** Shorten a long line to a window around its first match, keeping ranges valid. */
export function clipLine(line: string, ranges: Array<[number, number]>): { text: string; ranges: Array<[number, number]> } {
  const trimmedStart = line.length - line.trimStart().length
  const first = ranges[0]?.[0] ?? 0
  if (line.length - trimmedStart <= CLIP_BEFORE + CLIP_AFTER) {
    return {
      text: line.slice(trimmedStart),
      ranges: ranges.map(([a, b]) => [a - trimmedStart, b - trimmedStart] as [number, number])
    }
  }
  const from = Math.max(trimmedStart, first - CLIP_BEFORE)
  const to = Math.min(line.length, first + CLIP_AFTER)
  const prefix = from > trimmedStart ? '…' : ''
  const suffix = to < line.length ? '…' : ''
  const shift = from - prefix.length
  const text = prefix + line.slice(from, to) + suffix
  const out: Array<[number, number]> = []
  for (const [a, b] of ranges) {
    if (a < from || a >= to) continue
    out.push([a - shift, Math.min(b, to) - shift])
  }
  return { text, ranges: out }
}

/**
 * Find matching lines. `re` must come from buildMatcher (global). Stops collecting after
 * `maxLines` lines but keeps counting `totalLines`, so the UI can say "N more".
 */
export function searchText(text: string, re: RegExp, maxLines: number): TextSearchResult {
  re.lastIndex = 0
  if (!re.test(text)) return { matches: [], totalLines: 0 }
  const matches: LineMatch[] = []
  let totalLines = 0
  let lineNo = 0
  let pos = 0
  const n = text.length
  while (pos <= n) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = n
    lineNo++
    const stop = end > pos && text.charCodeAt(end - 1) === 13 ? end - 1 : end
    if (stop - pos <= MAX_LINE_FOR_MATCH && stop > pos) {
      const line = text.slice(pos, stop)
      re.lastIndex = 0
      const ranges: Array<[number, number]> = []
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++
          continue
        }
        ranges.push([m.index, m.index + m[0].length])
        if (ranges.length >= 50) break
      }
      if (ranges.length > 0) {
        totalLines++
        if (matches.length < maxLines) {
          const clipped = clipLine(line, ranges)
          matches.push({ line: lineNo, text: clipped.text, ranges: clipped.ranges })
        }
      }
    }
    if (end >= n) break
    pos = end + 1
  }
  re.lastIndex = 0
  return { matches, totalLines }
}

/** A NUL in the first 8000 bytes is the classic "this is not text" signal. */
export function looksBinary(bytes: Uint8Array): boolean {
  const len = Math.min(bytes.length, 8000)
  for (let i = 0; i < len; i++) if (bytes[i] === 0) return true
  return false
}

/** Extensions never worth opening for a text search (images, archives, media, compiled output). */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'avif', 'tiff', 'psd',
  'zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar', 'tar', 'jar', 'war', 'apk', 'dmg', 'iso',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'webm', 'wav', 'flac', 'ogg', 'm4a',
  'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'node', 'wasm', 'lib', 'obj',
  'sqlite', 'db', 'lockb', 'pack', 'idx', 'DS_Store'
])

export function hasBinaryExtension(relPath: string): boolean {
  const i = relPath.lastIndexOf('.')
  if (i < 0) return false
  return BINARY_EXTENSIONS.has(relPath.slice(i + 1).toLowerCase())
}
