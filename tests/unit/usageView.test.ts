import { describe, it, expect } from 'vitest'
import type { RealUsage } from '@shared/usageReal'
import type { UsageSample } from '@shared/usageHistory'
import {
  burnRate,
  fmtAge,
  fmtPct,
  moveMetric,
  readingFor,
  readingsFor,
  hasNoData,
  resetCountdown,
  setThreshold,
  sparkFor,
  sparkPath,
  toggleMetric,
  toneFor,
  usageTooltip,
  paceMarker,
  paceFor,
  paceLine,
  paceTooltipLine,
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
  noDataNote,
  noWindowsNote
} from '@renderer/state/usageView'

const th = { warnAt: 75, critAt: 90 }
const H = 3_600_000
const real = (o: Partial<RealUsage> = {}): RealUsage => ({
  fiveHour: { pct: 7, resetsAt: 10 * H },
  sevenDay: { pct: 80, resetsAt: 100 * H },
  updatedAt: 5 * H,
  capturedAt: 5 * H,
  contextPct: 29,
  model: 'Opus',
  costUsd: 1.5,
  ...o
})
const sample = (t: number, fiveHour: number | null, fiveReset: number | null = 10 * H): UsageSample => ({
  t,
  fiveHour,
  sevenDay: null,
  fiveReset
})

describe('toneFor', () => {
  it('is ok below warn, warn from warnAt, crit from critAt', () => {
    expect(toneFor(74.9, 75, 90)).toBe('ok')
    expect(toneFor(75, 75, 90)).toBe('warn')
    expect(toneFor(89, 75, 90)).toBe('warn')
    expect(toneFor(90, 75, 90)).toBe('crit')
    expect(toneFor(100, 75, 90)).toBe('crit')
  })
  it('treats missing data as ok', () => {
    expect(toneFor(null, 75, 90)).toBe('ok')
  })
})

describe('formatting', () => {
  it('formats the reset countdown, null without a reset time, "now" when past', () => {
    expect(resetCountdown(130 * 60_000, 0)).toBe('2h 10m')
    expect(resetCountdown(44 * 60_000, 0)).toBe('44m')
    expect(resetCountdown(null, 0)).toBeNull()
    expect(resetCountdown(5, 1000)).toBe('now')
  })
  it('formats percentages and data age', () => {
    expect(fmtPct(7)).toBe('7%')
    expect(fmtPct(23.6)).toBe('24%')
    expect(fmtPct(0.4)).toBe('<1%')
    expect(fmtAge(10_000)).toBe('just now')
    expect(fmtAge(5 * 60_000)).toBe('5m ago')
    expect(fmtAge(3 * H)).toBe('3h ago')
    expect(fmtAge(72 * H)).toBe('3d ago')
  })
})

describe('readings', () => {
  it('reads real windows with tone, and shows -- for a missing window', () => {
    const r = readingsFor(real(), ['fiveHour', 'sevenDay', 'context', 'cost'], th)
    expect(r.map((x) => x.text)).toEqual(['7%', '80%', '29%', '$1.50'])
    expect(r[1].tone).toBe('warn')
    const gone = readingFor(real({ fiveHour: null }), 'fiveHour', th)
    expect(gone.known).toBe(false)
    expect(gone.text).toBe('--')
  })
  it('has no data when nothing was captured or every chosen metric is unknown', () => {
    expect(hasNoData(readingsFor(null, ['fiveHour'], th))).toBe(true)
    expect(hasNoData(readingsFor(real({ fiveHour: null }), ['fiveHour'], th))).toBe(true)
    expect(hasNoData(readingsFor(real({ fiveHour: null }), ['fiveHour', 'context'], th))).toBe(false)
  })
})

describe('config reducers', () => {
  it('toggles metrics but never empties the list', () => {
    expect(toggleMetric(['fiveHour'], 'sevenDay')).toEqual(['fiveHour', 'sevenDay'])
    expect(toggleMetric(['fiveHour', 'sevenDay'], 'fiveHour')).toEqual(['sevenDay'])
    expect(toggleMetric(['fiveHour'], 'fiveHour')).toEqual(['fiveHour'])
  })
  it('moves metrics within bounds', () => {
    expect(moveMetric(['fiveHour', 'sevenDay', 'cost'], 'cost', -1)).toEqual(['fiveHour', 'cost', 'sevenDay'])
    expect(moveMetric(['fiveHour', 'sevenDay'], 'fiveHour', -1)).toEqual(['fiveHour', 'sevenDay'])
    expect(moveMetric(['fiveHour'], 'cost', 1)).toEqual(['fiveHour'])
  })
  it('keeps warnAt below critAt', () => {
    expect(setThreshold({ warnAt: 75, critAt: 90 }, 'warnAt', 95)).toEqual({ warnAt: 95, critAt: 96 })
    expect(setThreshold({ warnAt: 75, critAt: 90 }, 'critAt', 50)).toEqual({ warnAt: 49, critAt: 50 })
    expect(setThreshold({ warnAt: 75, critAt: 90 }, 'warnAt', 60)).toEqual({ warnAt: 60, critAt: 90 })
  })
})

describe('burnRate', () => {
  it('is percent per hour over the last hour of the current window', () => {
    const now = 6 * H
    const s = [sample(now - 50 * 60_000, 5), sample(now - 20 * 60_000, 8), sample(now - 5 * 60_000, 10)]
    expect(burnRate(s, 10 * H, now)).toBeCloseTo(5 / (45 / 60), 5)
  })
  it('hides with fewer than 2 samples, a tiny spread, or another window', () => {
    const now = 6 * H
    expect(burnRate([sample(now - 60_000, 5)], 10 * H, now)).toBeNull()
    expect(burnRate([sample(now - 3 * 60_000, 5), sample(now - 60_000, 6)], 10 * H, now)).toBeNull()
    expect(burnRate([sample(now - 30 * 60_000, 5, 99), sample(now - 5 * 60_000, 9, 99)], 10 * H, now)).toBeNull()
    expect(burnRate([], null, now)).toBeNull()
  })
  it('ignores samples older than an hour', () => {
    const now = 6 * H
    expect(burnRate([sample(now - 2 * H, 1), sample(now - 90 * 60_000, 2)], 10 * H, now)).toBeNull()
  })
})

describe('sparkline', () => {
  it('maps time and percent onto the box', () => {
    const d = sparkPath([{ t: 0, v: 0 }, { t: 10, v: 100 }], 0, 10, 100, 20)
    expect(d).toBe('M0.0,19.0 L100.0,1.0')
  })
  it('needs two real samples in the current window, else null (collecting data)', () => {
    const r = real()
    expect(sparkFor([sample(6 * H, 5)], 'fiveHour', r, 7 * H)).toBeNull()
    const two = [sample(6 * H, 5), sample(7 * H, 9)]
    expect(sparkFor(two, 'fiveHour', r, 7 * H)?.points).toHaveLength(2)
    expect(sparkFor(two, 'fiveHour', null, 7 * H)).toBeNull()
  })
})

describe('usageTooltip', () => {
  it('explains no data, and lists exact numbers with reset times and age', () => {
    expect(usageTooltip(null, 0, [], th)).toContain('Start Claude in a DockTerm terminal')
    const tip = usageTooltip(real(), 6 * H, [], th)
    expect(tip).toContain('5-hour window: 7% used')
    expect(tip).toContain('7-day window: 80% used')
    expect(tip).toContain('Context window: 29% used')
    expect(tip).toContain('Limits updated 1h ago')
  })
})

describe('panel notes', () => {
  const base = { fiveHour: null, sevenDay: null, updatedAt: null, capturedAt: 1, contextPct: 29, model: 'Haiku 4.5', costUsd: 0.1 }
  it('no note while a window is live', () => {
    expect(noWindowsNote({ ...base, fiveHour: { pct: 5, resetsAt: 9 } })).toBeNull()
  })
  it('expired windows are not described as "never sent"', () => {
    const n = noWindowsNote({ ...base, updatedAt: 5 })!
    expect(n).toMatch(/have ended/)
    expect(n).not.toMatch(/no rate limits|not sent/i)
  })
  it('a capture that never carried limits says so', () => {
    expect(noWindowsNote(base)).toMatch(/not sent rate limits/)
  })
  it('the empty state follows the capture settings', () => {
    expect(noDataNote(false, false)).toMatch(/off/)
    expect(noDataNote(true, false)).toMatch(/no status line/)
    expect(noDataNote(true, true)).not.toMatch(/no status line/)
  })
})

describe('paceMarker', () => {
  const W = FIVE_HOUR_MS
  const win = (pct: number, resetsAt: number) => ({ pct, resetsAt })
  it('is 0 at the start of the window', () => {
    const p = paceMarker(win(0, 1000 + W), W, 1000)
    expect(p).toEqual({ pacePct: 0, deltaPct: 0, state: 'even' })
  })
  it('is 50 in the middle and 100 just before the end', () => {
    expect(paceMarker(win(50, 1000 + W / 2), W, 1000)?.pacePct).toBeCloseTo(50, 6)
    expect(paceMarker(win(99, 1000 + 1), W, 1000)?.pacePct).toBeGreaterThan(99.99)
  })
  it('is null once the window ended, for a bad reset time or no window', () => {
    expect(paceMarker(win(10, 1000), W, 1000)).toBeNull()
    expect(paceMarker(win(10, 500), W, 1000)).toBeNull()
    expect(paceMarker(win(10, Number.NaN), W, 1000)).toBeNull()
    expect(paceMarker(win(Number.NaN, 5000), W, 1000)).toBeNull()
    expect(paceMarker(null, W, 1000)).toBeNull()
    expect(paceMarker(undefined, W, 1000)).toBeNull()
    expect(paceMarker(win(10, 5000), 0, 1000)).toBeNull()
  })
  it('clamps a reset time further away than one window to 0', () => {
    const p = paceMarker(win(5, 1000 + 2 * W), W, 1000)
    expect(p?.pacePct).toBe(0)
    expect(p?.state).toBe('ahead')
  })
  it('reports ahead when more is used than an even spend, behind when less', () => {
    const now = 0
    const reset = W * 0.74 // 26% elapsed
    const ahead = paceMarker(win(36, reset), W, now)
    expect(ahead?.pacePct).toBeCloseTo(26, 6)
    expect(ahead?.deltaPct).toBeCloseTo(10, 6)
    expect(ahead?.state).toBe('ahead')
    const behind = paceMarker(win(10, reset), W, now)
    expect(behind?.deltaPct).toBeCloseTo(-16, 6)
    expect(behind?.state).toBe('behind')
  })
  it('counts within 3 points as even (both edges)', () => {
    const reset = W * 0.5
    expect(paceMarker(win(53, reset), W, 0)?.state).toBe('even')
    expect(paceMarker(win(47, reset), W, 0)?.state).toBe('even')
    expect(paceMarker(win(53.5, reset), W, 0)?.state).toBe('ahead')
    expect(paceMarker(win(46.5, reset), W, 0)?.state).toBe('behind')
  })
  it('uses 7 days for the weekly window', () => {
    const now = 1_000_000
    expect(paceMarker(win(50, now + SEVEN_DAY_MS / 2), SEVEN_DAY_MS, now)?.pacePct).toBeCloseTo(50, 6)
  })
})

describe('paceFor, paceLine, paceTooltipLine', () => {
  it('gives a marker for the two windows only', () => {
    const now = 6 * H
    expect(paceFor(readingFor(real(), 'fiveHour', th), now)?.pacePct).toBeCloseTo(20, 6)
    expect(paceFor(readingFor(real(), 'sevenDay', th), now)).not.toBeNull()
    expect(paceFor(readingFor(real(), 'context', th), now)).toBeNull()
    expect(paceFor(readingFor(real(), 'cost', th), now)).toBeNull()
    expect(paceFor(readingFor(null, 'fiveHour', th), now)).toBeNull()
    expect(paceFor(readingFor(real(), 'fiveHour', th), 11 * H)).toBeNull()
  })
  it('draws the even-spend line from the window start to now, clipped to the chart', () => {
    const reset = 10 * H
    const start = reset - FIVE_HOUR_MS
    expect(paceLine(reset, FIVE_HOUR_MS, start, 7.5 * H)).toEqual([
      { t: start, v: 0 },
      { t: 7.5 * H, v: 50 }
    ])
    const clipped = paceLine(reset, FIVE_HOUR_MS, 6 * H, 7.5 * H)
    expect(clipped[0].t).toBe(6 * H)
    expect(clipped[0].v).toBeCloseTo(20, 6)
    expect(paceLine(reset, FIVE_HOUR_MS, start, 11 * H)).toEqual([])
    expect(paceLine(reset, FIVE_HOUR_MS, start, 4 * H)).toEqual([])
  })
  it('words the tooltip line with the real numbers', () => {
    const w = (u: number) => ({ pacePct: 26, deltaPct: u - 26, state: 'ahead' as const })
    expect(paceTooltipLine('fiveHour', 36, w(36))).toBe(
      'Pace (5-hour window): you have used 36%, an even spend would be 26% (10 points ahead)'
    )
    expect(paceTooltipLine('sevenDay', 21, { pacePct: 26, deltaPct: -5, state: 'behind' })).toContain('5 points behind')
    expect(paceTooltipLine('fiveHour', 27, { pacePct: 26, deltaPct: 1, state: 'even' })).toContain('(on pace)')
  })
  it('adds the pace line to the usage tooltip only when asked', () => {
    const now = 6 * H
    expect(usageTooltip(real(), now, [], th)).not.toContain('Pace (')
    const tip = usageTooltip(real(), now, [], th, true)
    expect(tip).toContain('Pace (5-hour window): you have used 7%, an even spend would be 20% (13 points behind)')
    expect(tip).toContain('Pace (7-day window)')
  })
})
