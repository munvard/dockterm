import { join } from 'node:path'
import { readdir, stat, open } from 'node:fs/promises'
import {
  KEEP_DAYS,
  DAY_MS,
  buildSnapshot,
  parseLimitLine,
  parseUsageLine,
  type LimitRecord,
  type PlanBudgets,
  type UsageRecord
} from './usageCore'
import type { UsageSnapshot } from '@shared/types'

/**
 * Tails Claude Code's transcripts (`<projectsDir>/<slug>/*.jsonl`) and keeps the
 * usage records. Runs in a worker thread (usageWorker.ts) so reading and JSON
 * parsing hundreds of MB never blocks the main process; the same class is the
 * in-process fallback. No Electron imports. Only token counts are read.
 */
export class UsageScanner {
  private records: UsageRecord[] = []
  private limitHits: LimitRecord[] = []
  private readonly seen = new Set<string>()
  private readonly seenLimits = new Set<string>()
  private readonly offsets = new Map<string, number>()

  constructor(private readonly projectsDir: string) {}

  private async readSlice(path: string, start: number, end: number): Promise<string> {
    const len = end - start
    if (len <= 0) return ''
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, start)
      return buf.toString('utf8')
    } finally {
      await fh.close()
    }
  }

  private async listTranscripts(): Promise<string[]> {
    let dirs: string[]
    try {
      dirs = await readdir(this.projectsDir)
    } catch {
      return [] // no ~/.claude/projects yet
    }
    const out: string[] = []
    for (const d of dirs) {
      const dir = join(this.projectsDir, d)
      try {
        const files = await readdir(dir)
        for (const f of files) if (f.endsWith('.jsonl')) out.push(join(dir, f))
      } catch {
        // not a directory / unreadable — skip
      }
    }
    return out
  }

  /** Tail any new bytes from changed transcripts. Returns true if anything new was added. */
  async scan(): Promise<boolean> {
    const files = await this.listTranscripts()
    const cutoff = Date.now() - KEEP_DAYS * DAY_MS
    let changed = false
    for (const path of files) {
      let size: number
      let mtime: number
      try {
        const st = await stat(path)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        continue
      }
      const prev = this.offsets.get(path) ?? 0
      // Never-read file that's older than our retention window — skip its history.
      if (prev === 0 && mtime < cutoff) {
        this.offsets.set(path, size)
        continue
      }
      if (size < prev) this.offsets.set(path, 0) // rotated / truncated → re-read
      const start = this.offsets.get(path) ?? 0
      if (size <= start) continue
      let text: string
      try {
        text = await this.readSlice(path, start, size)
      } catch {
        continue
      }
      const lastNl = text.lastIndexOf('\n')
      if (lastNl < 0) continue // no complete line appended yet
      const complete = text.slice(0, lastNl)
      this.offsets.set(path, start + Buffer.byteLength(complete, 'utf8') + 1)
      for (const line of complete.split('\n')) {
        const rec = parseUsageLine(line)
        if (rec) {
          if (rec.id === ':' || !this.seen.has(rec.id)) {
            if (rec.id !== ':') this.seen.add(rec.id)
            this.records.push(rec)
            changed = true
          }
        }
        const lim = parseLimitLine(line)
        if (lim) {
          const key = `${lim.ts}:${lim.resetAt}`
          if (!this.seenLimits.has(key)) {
            this.seenLimits.add(key)
            this.limitHits.push(lim)
            changed = true
          }
        }
      }
    }
    if (changed) {
      const keep = Date.now() - KEEP_DAYS * DAY_MS
      this.records = this.records.filter((r) => r.ts >= keep || r.ts === 0)
      this.limitHits = this.limitHits.filter((h) => h.ts >= keep)
    }
    return changed
  }

  snapshot(now: number, budgets: PlanBudgets): UsageSnapshot {
    return buildSnapshot(this.records, now, budgets, this.limitHits)
  }
}

/** Messages between the main process and the scan worker. */
export interface ScanRequest {
  id: number
  budgets: PlanBudgets
}
export interface ScanReply {
  id: number
  changed: boolean
  snapshot: UsageSnapshot
}
