import type { RealUsage, RealUsageWindow, UsageMetric, UsagePillConfig } from '@shared/usageReal'
import { seriesOf, type SeriesPoint, type UsageSample } from '@shared/usageHistory'
import { fmtCountdown, fmtResetClock } from '../components/usage/format'

export type Tone = 'ok' | 'warn' | 'crit'

/** Normal below `warnAt`, amber from `warnAt`, red from `critAt` (percent USED). */
export function toneFor(pct: number | null, warnAt: number, critAt: number): Tone {
  if (pct === null) return 'ok'
  if (pct >= critAt) return 'crit'
  if (pct >= warnAt) return 'warn'
  return 'ok'
}

export const METRIC_LABEL: Record<UsageMetric, string> = {
  fiveHour: '5h',
  sevenDay: '7d',
  context: 'Ctx',
  cost: 'Cost'
}

export const METRIC_NAME: Record<UsageMetric, string> = {
  fiveHour: '5-hour window',
  sevenDay: '7-day window',
  context: 'Context window',
  cost: 'Session cost'
}

export interface Thresholds {
  warnAt: number
  critAt: number
}

/** One value ready to draw. `pct` is null for a value that is not a percentage
 * (cost) or that Claude has not reported (`known` false). */
export interface Reading {
  metric: UsageMetric
  label: string
  pct: number | null
  text: string
  tone: Tone
  resetsAt: number | null
  known: boolean
}

export function fmtPct(pct: number): string {
  if (pct > 0 && pct < 1) return '<1%'
  return `${Math.round(pct)}%`
}

export function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function fmtAge(ms: number): string {
  if (ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** The 24h clock time a window ends, e.g. "18:40". */
export function fmtClock(epoch: number): string {
  return new Date(epoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** "2h 10m" until `resetsAt`, or null when there is no reset time. */
export function resetCountdown(resetsAt: number | null, now: number): string | null {
  return resetsAt === null ? null : fmtCountdown(resetsAt - now)
}

export function readingFor(real: RealUsage | null, metric: UsageMetric, th: Thresholds): Reading {
  const label = METRIC_LABEL[metric]
  const none: Reading = { metric, label, pct: null, text: '--', tone: 'ok', resetsAt: null, known: false }
  if (!real) return none
  if (metric === 'fiveHour' || metric === 'sevenDay') {
    const w = real[metric]
    if (!w) return none
    return {
      metric,
      label,
      pct: w.pct,
      text: fmtPct(w.pct),
      tone: toneFor(w.pct, th.warnAt, th.critAt),
      resetsAt: w.resetsAt,
      known: true
    }
  }
  if (metric === 'context') {
    if (real.contextPct === null) return none
    return {
      metric,
      label,
      pct: real.contextPct,
      text: fmtPct(real.contextPct),
      tone: toneFor(real.contextPct, th.warnAt, th.critAt),
      resetsAt: null,
      known: true
    }
  }
  if (real.costUsd === null) return none
  return { metric, label, pct: null, text: fmtCost(real.costUsd), tone: 'ok', resetsAt: null, known: true }
}

export function readingsFor(real: RealUsage | null, show: UsageMetric[], th: Thresholds): Reading[] {
  return show.map((m) => readingFor(real, m, th))
}

/** True when there is nothing real to draw for these metrics. */
export function hasNoData(readings: Reading[]): boolean {
  return readings.every((r) => !r.known)
}

/** Percent of the 5-hour window used per hour, from real samples of the CURRENT
 * window in the last hour. null (hide it) with fewer than 2 samples or under 5 minutes of spread. */
export function burnRate(samples: UsageSample[], fiveReset: number | null, now: number): number | null {
  if (fiveReset === null) return null
  const inHour = samples.filter((s) => s.t >= now - 3_600_000 && s.fiveHour !== null && s.fiveReset === fiveReset)
  if (inHour.length < 2) return null
  const a = inHour[0]
  const b = inHour[inHour.length - 1]
  const hours = (b.t - a.t) / 3_600_000
  if (hours < 5 / 60) return null
  return Math.max(0, ((b.fiveHour as number) - (a.fiveHour as number)) / hours)
}

export function fmtRate(rate: number): string {
  return `${rate < 10 ? rate.toFixed(1) : Math.round(rate)}%/h`
}

/** Metric list reducers for the settings UI. At least one metric always stays on. */
export function toggleMetric(show: UsageMetric[], metric: UsageMetric): UsageMetric[] {
  if (show.includes(metric)) return show.length > 1 ? show.filter((m) => m !== metric) : show
  return [...show, metric]
}

export function moveMetric(show: UsageMetric[], metric: UsageMetric, dir: -1 | 1): UsageMetric[] {
  const i = show.indexOf(metric)
  const j = i + dir
  if (i === -1 || j < 0 || j >= show.length) return show
  const out = [...show]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Set one threshold and keep warnAt below critAt (the other one gives way). */
export function setThreshold(
  cfg: Pick<UsagePillConfig, 'warnAt' | 'critAt'>,
  which: 'warnAt' | 'critAt',
  value: number
): Thresholds {
  const v = Math.min(100, Math.max(1, Math.round(value)))
  if (which === 'warnAt') return { warnAt: Math.min(v, 99), critAt: Math.max(cfg.critAt, Math.min(v, 99) + 1) }
  return { warnAt: Math.min(cfg.warnAt, Math.max(v, 2) - 1), critAt: Math.max(v, 2) }
}

/** SVG path for one line of samples, percent on a fixed 0 to 100 scale and time on
 * [from, to] mapped to [0, w]. Empty string with no points. */
export function sparkPath(points: SeriesPoint[], from: number, to: number, w: number, h: number): string {
  const span = Math.max(1, to - from)
  return points
    .map((p, i) => {
      const x = Math.min(w, Math.max(0, ((p.t - from) / span) * w))
      const y = h - Math.min(100, Math.max(0, p.v)) / 100 * (h - 2) - 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

export interface SparkData {
  points: SeriesPoint[]
  from: number
  to: number
}

/** The line the `graph` style draws for a window, from real samples only.
 * null = fewer than 2 samples ("collecting data"). The 5-hour graph is the current
 * window across its own 5 hours; the 7-day graph is the last 7 days. */
export function sparkFor(
  samples: UsageSample[],
  metric: 'fiveHour' | 'sevenDay',
  real: RealUsage | null,
  now: number
): SparkData | null {
  const w = real?.[metric]
  if (!w) return null
  const span = metric === 'fiveHour' ? 5 * 3_600_000 : 7 * 24 * 3_600_000
  const from = w.resetsAt - span
  const lines = seriesOf(samples, metric, from)
  const pts = lines.length ? lines[lines.length - 1] : []
  if (pts.length < 2) return null
  return { points: pts, from, to: Math.max(w.resetsAt, now) }
}

/** Multi-line hover text with the exact numbers, absolute reset times and the age
 * of the data. Plain text for a native title. */
export function usageTooltip(
  real: RealUsage | null,
  now: number,
  samples: UsageSample[],
  th: Thresholds,
  showPace = false
): string {
  if (!real) return 'No usage data yet. Start Claude in a DockTerm terminal to see your real usage.'
  const lines: string[] = []
  for (const metric of ['fiveHour', 'sevenDay'] as const) {
    const r = readingFor(real, metric, th)
    if (r.known && r.resetsAt !== null) {
      lines.push(
        `${METRIC_NAME[metric]}: ${r.text} used, resets ${fmtResetClock(r.resetsAt)} (in ${fmtCountdown(r.resetsAt - now)})`
      )
      const pace = showPace ? paceFor(r, now) : null
      if (pace && r.pct !== null) lines.push(paceTooltipLine(metric, r.pct, pace))
    } else {
      lines.push(`${METRIC_NAME[metric]}: no data (no limit info yet, or the window has reset)`)
    }
  }
  const ctx = readingFor(real, 'context', th)
  if (ctx.known) lines.push(`Context window: ${ctx.text} used`)
  const cost = readingFor(real, 'cost', th)
  if (cost.known) lines.push(`Session cost: ${cost.text} (Claude's own estimate)`)
  if (real.fiveHour) {
    const rate = burnRate(samples, real.fiveHour.resetsAt, now)
    lines.push(
      `5-hour window ends at ${fmtClock(real.fiveHour.resetsAt)}` + (rate !== null ? `, using ${fmtRate(rate)}` : '')
    )
  }
  lines.push(real.updatedAt !== null ? `Limits updated ${fmtAge(now - real.updatedAt)}` : 'No limit info captured yet')
  return lines.join('\n')
}

/** The panel note under the real usage card when Claude has reported no live limit
 * window. Null when at least one window is live. A report that existed but has
 * ended (the windows reset) must not read as "never sent". */
export function noWindowsNote(real: RealUsage): string | null {
  if (real.fiveHour || real.sevenDay) return null
  if (real.updatedAt !== null) {
    return 'The limit windows Claude last reported have ended. New numbers arrive with the next reply in a Claude session.'
  }
  return 'Claude has not sent rate limits yet. They exist for Pro and Max plans, after the first reply in a session.'
}

/** The panel note when no capture has arrived at all. */
export function noDataNote(captureEnabled: boolean, withoutStatusLine: boolean): string {
  if (!captureEnabled) {
    return 'Capture from terminals is off, so no real usage arrives. Turn it on under Data below.'
  }
  const base = 'No data yet. Start Claude in a DockTerm terminal to see your real usage. These are the numbers Claude Code itself reports.'
  return withoutStatusLine
    ? base
    : base + ' If you have no status line set up in Claude, turn on "Also capture without a status line" under Data below.'
}

export const FIVE_HOUR_MS = 18_000_000
export const SEVEN_DAY_MS = 604_800_000

/** Within this many points of an even spend counts as "on pace". */
export const PACE_EVEN_BAND = 3

export interface PaceMarker {
  /** Where usage would be (0 to 100) if the window were spent evenly so far. */
  pacePct: number
  /** Used minus pacePct. Positive = ahead of an even spend (using it faster). */
  deltaPct: number
  state: 'ahead' | 'behind' | 'even'
}

/** The window length for a metric that has one (5h, 7d), else null. */
export function windowMsFor(metric: UsageMetric): number | null {
  return metric === 'fiveHour' ? FIVE_HOUR_MS : metric === 'sevenDay' ? SEVEN_DAY_MS : null
}

/** Where an even spend of a window would be right now, against the real usage.
 * null when there is no window, its reset time is not a number, or it has already
 * ended (resetsAt in the past). */
export function paceMarker(window: RealUsageWindow | null | undefined, windowMs: number, now: number): PaceMarker | null {
  if (!window || !Number.isFinite(window.resetsAt) || !Number.isFinite(window.pct) || !(windowMs > 0)) return null
  if (window.resetsAt <= now) return null
  const elapsed = Math.min(1, Math.max(0, 1 - (window.resetsAt - now) / windowMs))
  const pacePct = elapsed * 100
  const deltaPct = window.pct - pacePct
  const state = deltaPct > PACE_EVEN_BAND ? 'ahead' : deltaPct < -PACE_EVEN_BAND ? 'behind' : 'even'
  return { pacePct, deltaPct, state }
}

/** The marker for one reading (null for context, cost and unknown values). */
export function paceFor(r: Reading, now: number): PaceMarker | null {
  const ms = windowMsFor(r.metric)
  if (ms === null || !r.known || r.pct === null || r.resetsAt === null) return null
  return paceMarker({ pct: r.pct, resetsAt: r.resetsAt }, ms, now)
}

/** The two ends of the even-spend line for the graph: from the window start (or the
 * left edge of the chart, whichever is later) to now. Empty when the window has not
 * started or ended. */
export function paceLine(resetsAt: number, windowMs: number, from: number, now: number): SeriesPoint[] {
  const start = resetsAt - windowMs
  const t0 = Math.max(start, from)
  if (!(now > t0) || resetsAt <= now) return []
  const v = (t: number): number => Math.min(100, Math.max(0, ((t - start) / windowMs) * 100))
  return [
    { t: t0, v: v(t0) },
    { t: now, v: v(now) }
  ]
}

/** One tooltip line: "Pace (5-hour window): you have used 36%, an even spend would be 26% (10 points ahead)". */
export function paceTooltipLine(metric: UsageMetric, usedPct: number, p: PaceMarker): string {
  const used = Math.round(usedPct)
  const even = Math.round(p.pacePct)
  const gap = Math.round(Math.abs(p.deltaPct))
  const how =
    p.state === 'even' ? 'on pace' : `${gap} point${gap === 1 ? '' : 's'} ${p.state === 'ahead' ? 'ahead' : 'behind'}`
  return `Pace (${METRIC_NAME[metric]}): you have used ${used}%, an even spend would be ${even}% (${how})`
}
