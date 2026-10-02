import type { RealUsage } from './usageReal'

/** One real sample of Claude's own percentages. `t` is the time of the capture that
 * carried them (never "now"), so a gap in the data stays a gap. */
export interface UsageSample {
  t: number
  fiveHour: number | null
  sevenDay: number | null
  /** The 5-hour window these belong to (its reset time), to tell windows apart. */
  fiveReset: number | null
}

export const HISTORY_KEEP_MS = 7 * 24 * 3_600_000
const MINUTE_MS = 60_000

/** The sample a RealUsage carries, or null when it carries no real percentage. */
export function sampleFromReal(real: RealUsage | null): UsageSample | null {
  if (!real || real.updatedAt === null) return null
  if (!real.fiveHour && !real.sevenDay) return null
  return {
    t: real.updatedAt,
    fiveHour: real.fiveHour ? real.fiveHour.pct : null,
    sevenDay: real.sevenDay ? real.sevenDay.pct : null,
    fiveReset: real.fiveHour ? real.fiveHour.resetsAt : null
  }
}

/** Drop samples older than the 7-day keep window (and any from the future of `now`
 * by more than a day, which a wrong clock could have written). */
export function pruneSamples(samples: UsageSample[], now: number): UsageSample[] {
  const from = now - HISTORY_KEEP_MS
  const first = samples.findIndex((s) => s.t >= from)
  const kept = first === -1 ? [] : first === 0 ? samples : samples.slice(first)
  return kept.length && kept[kept.length - 1].t > now + 24 * 3_600_000 ? kept.filter((s) => s.t <= now) : kept
}

/** Add a sample: at most one per minute (a newer one in the same minute replaces
 * the last), older or equal times are ignored, old samples are pruned. Returns the
 * SAME array when nothing changed. */
export function appendSample(samples: UsageSample[], next: UsageSample, now: number): UsageSample[] {
  const last = samples[samples.length - 1]
  let out: UsageSample[]
  if (!last) out = [next]
  else if (next.t <= last.t) return samples
  else if (Math.floor(next.t / MINUTE_MS) === Math.floor(last.t / MINUTE_MS)) out = [...samples.slice(0, -1), next]
  else out = [...samples, next]
  return pruneSamples(out, now)
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The history file's JSON to clean samples, oldest first. Anything malformed is dropped. */
export function sanitizeSamples(raw: unknown): UsageSample[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as { samples?: unknown }).samples
  if (!Array.isArray(list)) return []
  const out: UsageSample[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const t = num(r.t)
    if (t === null) continue
    const s: UsageSample = { t, fiveHour: num(r.fiveHour), sevenDay: num(r.sevenDay), fiveReset: num(r.fiveReset) }
    if (s.fiveHour === null && s.sevenDay === null) continue
    if (out.length && s.t <= out[out.length - 1].t) continue
    out.push(s)
  }
  return out
}

export interface SeriesPoint {
  t: number
  v: number
}

/** A window's percentages as lines: a new line starts when the 5-hour window
 * changed or the value fell (a reset), so a reset never draws a false slope. */
export function seriesOf(
  samples: UsageSample[],
  metric: 'fiveHour' | 'sevenDay',
  fromMs: number
): SeriesPoint[][] {
  const lines: SeriesPoint[][] = []
  let cur: SeriesPoint[] = []
  let prev: UsageSample | null = null
  for (const s of samples) {
    if (s.t < fromMs) continue
    const v = s[metric]
    if (v === null) {
      if (cur.length) lines.push(cur)
      cur = []
      prev = null
      continue
    }
    const lastV = cur.length ? cur[cur.length - 1].v : null
    const windowChanged = metric === 'fiveHour' && prev !== null && prev.fiveReset !== s.fiveReset
    if (cur.length && (windowChanged || (lastV !== null && v < lastV - 0.5))) {
      lines.push(cur)
      cur = []
    }
    cur.push({ t: s.t, v })
    prev = s
  }
  if (cur.length) lines.push(cur)
  return lines
}
