import { SCATTER_MAX, charMask, parseQuickQuery, scoreTokens, slashCount, highlightPositions, type ParsedQuickQuery } from './fuzzy'

/** Entry flags. */
export const F_DIR = 1
/** Ignored by .gitignore or the built-in ignore list (node_modules, dist, ...). */
export const F_IGNORED = 2
/** Inside a .git folder. */
export const F_GIT = 4
const F_DEAD = 8

export const DEFAULT_MAX_ENTRIES = 500_000

export interface QuickOptions {
  includeIgnored: boolean
  /** 'files' for Quick Open, 'both' for the explorer filter and `@` mentions. */
  kinds: 'files' | 'both'
  limit: number
  /** Recently opened relPaths, most recent first. */
  recent?: readonly string[]
}

export interface QuickHit {
  relPath: string
  isDir: boolean
  ignored: boolean
  score: number
  /** Character positions of the match inside relPath, for highlighting. */
  positions: number[]
}

export interface QuickResults {
  hits: QuickHit[]
  /** Every entry that matched (not just the returned page). */
  total: number
  /** True when `total` is a lower bound: once the page was full of better matches, scattered ones stopped being counted. */
  totalApprox?: boolean
  line: number | null
  col: number | null
}

/**
 * Compact in-memory index of a project's paths. Parallel arrays plus a letter
 * bitmask per entry (a one-instruction prefilter), so a query over hundreds of
 * thousands of paths takes a few milliseconds. Removal tombstones an entry; the
 * arrays compact themselves once a quarter of them is dead.
 */
export class PathIndex {
  private paths: string[] = []
  private lower: string[] = []
  private flags = new Uint8Array(1024)
  private masks = new Int32Array(1024)
  /** Slash count per entry (capped at 255), so scoring never scans a path for its depth. */
  private depth = new Uint8Array(1024)
  private byPath = new Map<string, number>()
  private count = 0
  private dead = 0
  private fileCount = 0
  private dirCount = 0
  truncated = false

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  get size(): number {
    return this.count - this.dead
  }
  get files(): number {
    return this.fileCount
  }
  get dirs(): number {
    return this.dirCount
  }

  has(relPath: string): boolean {
    return this.byPath.has(relPath)
  }

  /** Add (or update the flags of) an entry. Returns false when the cap stopped it. */
  add(relPath: string, flags: number): boolean {
    const existing = this.byPath.get(relPath)
    if (existing !== undefined) {
      const old = this.flags[existing]
      this.flags[existing] = (flags & ~F_DEAD) | 0
      if (old & F_DIR) this.dirCount--
      else this.fileCount--
      if (flags & F_DIR) this.dirCount++
      else this.fileCount++
      return true
    }
    if (this.size >= this.maxEntries) {
      this.truncated = true
      return false
    }
    if (this.count === this.flags.length) {
      const flags2 = new Uint8Array(this.flags.length * 2)
      flags2.set(this.flags)
      this.flags = flags2
      const masks2 = new Int32Array(this.masks.length * 2)
      masks2.set(this.masks)
      this.masks = masks2
      const depth2 = new Uint8Array(this.depth.length * 2)
      depth2.set(this.depth)
      this.depth = depth2
    }
    const id = this.count++
    const lower = relPath.toLowerCase()
    this.paths[id] = relPath
    this.lower[id] = lower
    this.flags[id] = flags & ~F_DEAD
    this.masks[id] = charMask(lower)
    this.depth[id] = Math.min(255, slashCount(relPath))
    this.byPath.set(relPath, id)
    if (flags & F_DIR) this.dirCount++
    else this.fileCount++
    return true
  }

  remove(relPath: string): boolean {
    const id = this.byPath.get(relPath)
    if (id === undefined) return false
    this.kill(id)
    this.maybeCompact()
    return true
  }

  /** Remove a folder entry and everything under it. */
  removeTree(relPath: string): number {
    const prefix = `${relPath}/`
    let removed = 0
    for (let id = 0; id < this.count; id++) {
      if (this.flags[id] & F_DEAD) continue
      const p = this.paths[id]
      if (p === relPath || p.startsWith(prefix)) {
        this.kill(id)
        removed++
      }
    }
    this.maybeCompact()
    return removed
  }

  clear(): void {
    this.paths = []
    this.lower = []
    this.flags = new Uint8Array(1024)
    this.masks = new Int32Array(1024)
    this.depth = new Uint8Array(1024)
    this.byPath.clear()
    this.count = 0
    this.dead = 0
    this.fileCount = 0
    this.dirCount = 0
    this.truncated = false
  }

  private kill(id: number): void {
    if (this.flags[id] & F_DIR) this.dirCount--
    else this.fileCount--
    this.byPath.delete(this.paths[id])
    this.flags[id] |= F_DEAD
    this.paths[id] = ''
    this.lower[id] = ''
    this.dead++
  }

  private maybeCompact(): void {
    if (this.dead < 1024 || this.dead * 4 < this.count) return
    let w = 0
    for (let r = 0; r < this.count; r++) {
      if (this.flags[r] & F_DEAD) continue
      if (w !== r) {
        this.paths[w] = this.paths[r]
        this.lower[w] = this.lower[r]
        this.flags[w] = this.flags[r]
        this.masks[w] = this.masks[r]
        this.depth[w] = this.depth[r]
      }
      this.byPath.set(this.paths[w], w)
      w++
    }
    this.paths.length = w
    this.lower.length = w
    this.count = w
    this.dead = 0
  }

  /** Visit live entries, optionally filtering by flags. `fn` returns false to stop. */
  forEach(includeIgnored: boolean, filesOnly: boolean, fn: (relPath: string, flags: number) => boolean | void): void {
    const hide = includeIgnored ? 0 : F_IGNORED | F_GIT
    for (let id = 0; id < this.count; id++) {
      const f = this.flags[id]
      if (f & F_DEAD) continue
      if (f & hide) continue
      if (filesOnly && f & F_DIR) continue
      if (fn(this.paths[id], f) === false) return
    }
  }

  countMatching(includeIgnored: boolean, filesOnly: boolean): number {
    let n = 0
    this.forEach(includeIgnored, filesOnly, () => {
      n++
    })
    return n
  }

  query(rawQuery: string | ParsedQuickQuery, opts: QuickOptions): QuickResults {
    const q = typeof rawQuery === 'string' ? parseQuickQuery(rawQuery) : rawQuery
    const hide = opts.includeIgnored ? 0 : F_IGNORED | F_GIT
    const filesOnly = opts.kinds === 'files'
    const limit = Math.max(1, opts.limit)
    const recentRank = new Map<string, number>()
    if (opts.recent) opts.recent.forEach((p, i) => recentRank.set(p, i))
    const recentN = Math.max(1, opts.recent?.length ?? 1)
    const recentBoost = (p: string): number => {
      const r = recentRank.get(p)
      return r === undefined ? 0 : 160 * (1 - r / recentN) + 40
    }

    // Top-K by score, kept sorted descending by binary insertion.
    const topId: number[] = []
    const topScore: number[] = []
    let total = 0
    let floor = -Infinity
    const consider = (id: number, score: number): void => {
      total++
      if (topId.length >= limit && score <= floor) return
      let lo = 0
      let hi = topScore.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (topScore[mid] >= score) lo = mid + 1
        else hi = mid
      }
      topScore.splice(lo, 0, score)
      topId.splice(lo, 0, id)
      if (topId.length > limit) {
        topScore.pop()
        topId.pop()
      }
      if (topId.length >= limit) floor = topScore[topScore.length - 1]
    }

    let qMask = 0
    for (const t of q.tokens) qMask |= charMask(t.replace(/\//g, ''))
    const scatterCeiling = SCATTER_MAX * q.tokens.length + (recentRank.size > 0 ? 201 : 0)
    let noScatter = false
    const exts = q.exts.map((e) => `.${e}`)

    for (let id = 0; id < this.count; id++) {
      const f = this.flags[id]
      if (f & F_DEAD) continue
      if (f & hide) continue
      if (filesOnly && f & F_DIR) continue
      if (qMask & ~this.masks[id]) continue
      const lower = this.lower[id]
      if (exts.length > 0) {
        if (f & F_DIR) continue
        let okExt = false
        for (const e of exts) {
          if (lower.endsWith(e)) {
            okExt = true
            break
          }
        }
        if (!okExt) continue
      }
      const orig = this.paths[id]
      let score: number
      if (q.tokens.length === 0) {
        score = 100 - lower.length * 0.06
      } else {
        score = scoreTokens(q.tokens, lower, orig, orig.lastIndexOf('/') + 1, noScatter)
        if (score === -Infinity) continue
      }
      if (f & F_IGNORED) score -= 40
      if (f & F_DIR) score -= 8
      if (recentRank.size > 0) score += recentBoost(orig)
      if (q.tokens.length > 0) {
        score -= this.depth[id] * 0.8
        if (score < 0) continue
      }
      consider(id, score)
      // A full page whose worst hit beats anything a scattered match can score: stop looking for those.
      if (!noScatter && q.tokens.length > 0 && floor >= scatterCeiling) noScatter = true
    }

    const hits: QuickHit[] = topId.map((id, i) => {
      const relPath = this.paths[id]
      return {
        relPath,
        isDir: (this.flags[id] & F_DIR) !== 0,
        ignored: (this.flags[id] & (F_IGNORED | F_GIT)) !== 0,
        score: topScore[i],
        positions: q.tokens.length ? highlightPositions(q.tokens, relPath) : []
      }
    })
    return { hits, total, ...(noScatter ? { totalApprox: true } : {}), line: q.line, col: q.col }
  }
}
