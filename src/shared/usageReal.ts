/** Real Claude usage, captured from Claude Code's own status line JSON (never
 * estimated). Everything here is what Claude itself reported, or null. */

/** One rate-limit window as Claude reports it. */
export interface RealUsageWindow {
  /** Percent of the window used, 0 to 100 (can be fractional, e.g. 23.5). */
  pct: number
  /** Epoch MILLISECONDS when the window resets. Claude sends seconds; main converts. */
  resetsAt: number
}

export interface RealUsage {
  /** The 5-hour window, or null when Claude reported none or it has already reset. */
  fiveHour: RealUsageWindow | null
  /** The 7-day window, or null when Claude reported none or it has already reset. */
  sevenDay: RealUsageWindow | null
  /** Epoch ms of the last capture that carried rate_limits (the age of the two
   * percentages above), or null when no capture ever had them (e.g. a free plan). */
  updatedAt: number | null
  /** Epoch ms of the last capture of any kind (a Claude session was alive then). */
  capturedAt: number
  /** Context window use (0 to 100) of the session captured last, or null. */
  contextPct: number | null
  /** Display name of that session's model ("Opus", "Haiku 4.5"), or null. */
  model: string | null
  /** That session's estimated cost in USD (Claude's client-side estimate), or null. */
  costUsd: number | null
}

export type UsageMetric = 'fiveHour' | 'sevenDay' | 'context' | 'cost'
export type UsageStyle = 'percent' | 'bar' | 'ring' | 'graph'

export const USAGE_METRICS: readonly UsageMetric[] = ['fiveHour', 'sevenDay', 'context', 'cost']
export const USAGE_STYLES: readonly UsageStyle[] = ['percent', 'bar', 'ring', 'graph']

/** Where the usage pill (top bar) gets its numbers and how it draws them. */
export interface UsagePillConfig {
  /** Which values to show, in this order. */
  show: UsageMetric[]
  style: UsageStyle
  /** Show "resets in 2h 10m" next to a window. */
  showReset: boolean
  /** Mark where an even spend of the 5h and 7d window would be right now. */
  paceMarker: boolean
  /** Colour turns amber at this percent used. */
  warnAt: number
  /** Colour turns red at this percent used. */
  critAt: number
}

/** The floating always-on-top usage window (all fields persist across restarts). */
export interface UsageFloatConfig {
  enabled: boolean
  /** Window position in screen pixels, null = let the OS/app pick a default corner. */
  x: number | null
  y: number | null
  w: number
  h: number
  alwaysOnTop: boolean
  /** 0.3 to 1. */
  opacity: number
  show: UsageMetric[]
  style: UsageStyle
  showReset: boolean
  paceMarker: boolean
}
