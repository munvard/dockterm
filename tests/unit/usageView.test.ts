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
  usageTooltip
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
