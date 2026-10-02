import { describe, it, expect } from 'vitest'
import type { RealUsage } from '@shared/usageReal'
import {
  HISTORY_KEEP_MS,
  appendSample,
  pruneSamples,
  sampleFromReal,
  sanitizeSamples,
  seriesOf,
  type UsageSample
} from '@shared/usageHistory'

const MIN = 60_000
const s = (t: number, fiveHour: number | null = 10, sevenDay: number | null = 20, fiveReset: number | null = 1000): UsageSample => ({
  t,
  fiveHour,
  sevenDay,
  fiveReset
})
const NOW = 10 * HISTORY_KEEP_MS

describe('sampleFromReal', () => {
  const base: RealUsage = {
    fiveHour: { pct: 7, resetsAt: 5000 },
    sevenDay: null,
    updatedAt: 1234,
    capturedAt: 1234,
    contextPct: null,
    model: null,
    costUsd: null
  }
  it('stamps the sample with the time of the capture, not now', () => {
    expect(sampleFromReal(base)).toEqual({ t: 1234, fiveHour: 7, sevenDay: null, fiveReset: 5000 })
  })
  it('is null without real percentages', () => {
    expect(sampleFromReal(null)).toBeNull()
    expect(sampleFromReal({ ...base, fiveHour: null })).toBeNull()
    expect(sampleFromReal({ ...base, updatedAt: null })).toBeNull()
  })
})

describe('appendSample', () => {
  it('appends, replaces within the same minute, and ignores old or equal times', () => {
    let list = appendSample([], s(NOW), NOW)
    expect(list).toHaveLength(1)
    const same = appendSample(list, s(NOW + 20_000, 11), NOW + 20_000)
    expect(same).toHaveLength(1)
    expect(same[0].fiveHour).toBe(11)
    list = appendSample(same, s(NOW + 2 * MIN, 12), NOW + 2 * MIN)
    expect(list).toHaveLength(2)
    expect(appendSample(list, s(NOW), NOW + 2 * MIN)).toBe(list)
    expect(appendSample(list, s(NOW + 2 * MIN), NOW + 2 * MIN)).toBe(list)
  })
  it('prunes samples older than 7 days', () => {
    const old = s(NOW - HISTORY_KEEP_MS - 1)
    const fresh = s(NOW - HISTORY_KEEP_MS + MIN)
    const out = appendSample([old, fresh], s(NOW), NOW)
    expect(out).toEqual([fresh, s(NOW)])
    expect(pruneSamples([old], NOW)).toEqual([])
  })
})

describe('sanitizeSamples', () => {
  it('keeps clean ordered samples and drops junk', () => {
    const raw = {
      v: 1,
      samples: [s(1), { t: 'x' }, null, { t: 2, fiveHour: null, sevenDay: null }, s(0), s(3, null, 5, null), { t: 4, fiveHour: 'a', sevenDay: 3 }]
    }
    expect(sanitizeSamples(raw).map((x) => x.t)).toEqual([1, 3, 4])
    expect(sanitizeSamples(null)).toEqual([])
    expect(sanitizeSamples({ samples: 5 })).toEqual([])
  })
})

describe('seriesOf', () => {
  it('splits the line at a window change or a drop so a reset draws no slope', () => {
    const list = [s(1, 10, 20, 100), s(2, 30, 21, 100), s(3, 2, 22, 200), s(4, 5, 23, 200)]
    const five = seriesOf(list, 'fiveHour', 0)
    expect(five.map((l) => l.map((p) => p.v))).toEqual([[10, 30], [2, 5]])
    expect(seriesOf(list, 'sevenDay', 0)).toHaveLength(1)
  })
  it('respects the start time and null values', () => {
    const list = [s(1, 10), s(2, null, 5), s(3, 20)]
    expect(seriesOf(list, 'fiveHour', 2).map((l) => l.length)).toEqual([1])
    expect(seriesOf(list, 'fiveHour', 0).map((l) => l.length)).toEqual([1, 1])
  })
})
