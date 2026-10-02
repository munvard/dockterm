/**
 * Pure fuzzy path matching for Quick Open. No fs, no DOM: it runs inside the
 * index worker and is unit-tested directly.
 *
 * A query is split into space separated tokens. Every token has to match the
 * path (AND). A token is tried, best first, as: a contiguous substring of the
 * file name, a subsequence of the file name, a contiguous substring of the whole
 * path, a subsequence of the whole path. Word starts and consecutive characters
 * score higher, and shorter, shallower paths win ties.
 */

export interface ParsedQuickQuery {
  /** Lowercased fuzzy tokens (a token holding "/" matches against the whole path). */
  tokens: string[]
  /** Extension filters from `*.tsx` tokens, lowercase, no dot. Empty = any. */
  exts: string[]
  /** 1-based line from a `name:42` suffix. */
  line: number | null
  col: number | null
}

const EXT_TOKEN = /^\*\.([a-z0-9_.+-]+)$/i
const LINE_SUFFIX = /^(.*?)(?:[:#])(\d+)(?::(\d+))?$/

export function parseQuickQuery(input: string): ParsedQuickQuery {
  let text = input.trim().replace(/\\/g, '/')
  let line: number | null = null
  let col: number | null = null
  const m = LINE_SUFFIX.exec(text)
  if (m) {
    text = m[1]
    line = Math.max(1, parseInt(m[2], 10))
    col = m[3] ? Math.max(1, parseInt(m[3], 10)) : null
  }
  const tokens: string[] = []
  const exts: string[] = []
  for (const raw of text.split(/\s+/)) {
    if (!raw) continue
    const e = EXT_TOKEN.exec(raw)
    if (e) exts.push(e[1].toLowerCase())
    else tokens.push(raw.toLowerCase())
  }
  return { tokens, exts, line, col }
}

const SLASH = 47
const SCORE_CHAR = 14
const SCORE_CONSEC = 18

function isWordSep(c: number): boolean {
  // - _ . space
  return c === 45 || c === 95 || c === 46 || c === 32
}

function boundaryBonus(orig: string, i: number): number {
  if (i === 0) return 26
  const prev = orig.charCodeAt(i - 1)
  if (prev === SLASH) return 28
  if (isWordSep(prev)) return 22
  const cur = orig.charCodeAt(i)
  // camelCase: lower -> Upper
  if (prev >= 97 && prev <= 122 && cur >= 65 && cur <= 90) return 18
  return 0
}

/** Positions of a tight subsequence match of `tok` inside lower[from, to), or null. */
function subsequence(tok: string, lower: string, from: number, to: number): number[] | null {
  const n = tok.length
  let ti = 0
  let end = -1
  for (let i = from; i < to; i++) {
    if (lower.charCodeAt(i) === tok.charCodeAt(ti)) {
      ti++
      if (ti === n) {
        end = i
        break
      }
    }
  }
  if (end < 0) return null
  // Walk back from the end to the tightest window, then collect the positions.
  let tj = n - 1
  let start = end
  for (let i = end; i >= from; i--) {
    if (lower.charCodeAt(i) === tok.charCodeAt(tj)) {
      tj--
      if (tj < 0) {
        start = i
        break
      }
    }
  }
  const pos: number[] = []
  ti = 0
  for (let i = start; i <= end && ti < n; i++) {
    if (lower.charCodeAt(i) === tok.charCodeAt(ti)) {
      pos.push(i)
      ti++
    }
  }
  return pos
}

function scorePositions(pos: number[], orig: string, from: number): number {
  let s = 0
  let prev = -2
  for (const p of pos) {
    s += SCORE_CHAR + boundaryBonus(orig, p)
    if (p === prev + 1) s += SCORE_CONSEC
    else if (prev >= 0) s -= Math.min(p - prev - 1, 10) + 2
    prev = p
  }
  s -= Math.min(pos[0] - from, 8) * 0.5
  return s
}

/**
 * Score one token against a path. `lower` is the lowercased path, `orig` the
 * original, `nameStart` the index of the file name's first character. Returns -1
 * for no match. When `out` is given, the matched character positions are pushed.
 */
export function matchToken(
  tok: string,
  lower: string,
  orig: string,
  nameStart: number,
  out?: number[]
): number {
  const len = tok.length
  const hasSlash = tok.indexOf('/') >= 0
  if (!hasSlash) {
    // a: contiguous substring of the file name
    const i = lower.indexOf(tok, nameStart)
    if (i >= 0) {
      let s = 300 + len * 6
      if (i === nameStart) s += 80
      else s += boundaryBonus(orig, i) * 1.5
      if (len === lower.length - nameStart) s += 200
      if (out) for (let k = 0; k < len; k++) out.push(i + k)
      return s
    }
    // b: subsequence of the file name
    const pos = subsequence(tok, lower, nameStart, lower.length)
    if (pos) {
      if (out) out.push(...pos)
      return 100 + Math.max(0, scorePositions(pos, orig, nameStart))
    }
  }
  // c: contiguous substring of the whole path
  const j = lower.indexOf(tok)
  if (j >= 0) {
    if (out) for (let k = 0; k < len; k++) out.push(j + k)
    return 60 + len * 5 + boundaryBonus(orig, j)
  }
  // d: subsequence of the whole path
  const pos = subsequence(tok, lower, 0, lower.length)
  if (pos) {
    if (out) out.push(...pos)
    // Squashed below 55 so any contiguous path match (60 and up) always outranks a scattered one.
    const raw = Math.max(0, scorePositions(pos, orig, 0) * 0.6)
    return 1 + 54 * (raw / (raw + 60))
  }
  return -1
}

/** Cheap 32-bit letter mask used as a prefilter: a query char absent from the path rules it out. */
export function charMask(s: string): number {
  let m = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 97 && c <= 122) m |= 1 << (c - 97)
    else if (c >= 48 && c <= 57) m |= 1 << (26 + ((c - 48) % 6))
  }
  return m
}

/** Score of a whole path for a parsed query (sum over tokens, small length penalties). -1 = no match. */
export function scorePath(
  tokens: readonly string[],
  lower: string,
  orig: string,
  out?: number[]
): number {
  const nameStart = orig.lastIndexOf('/') + 1
  let total = 0
  for (const tok of tokens) {
    const s = matchToken(tok, lower, orig, nameStart, out)
    if (s < 0) return -1
    total += s
  }
  let slashes = 0
  for (let i = 0; i < orig.length; i++) if (orig.charCodeAt(i) === SLASH) slashes++
  return total - orig.length * 0.06 - slashes * 0.8
}

/** Matched character positions for display highlighting, deduplicated and sorted. */
export function highlightPositions(tokens: readonly string[], orig: string): number[] {
  const out: number[] = []
  const lower = orig.toLowerCase()
  const nameStart = orig.lastIndexOf('/') + 1
  for (const tok of tokens) matchToken(tok, lower, orig, nameStart, out)
  return [...new Set(out)].sort((a, b) => a - b)
}
