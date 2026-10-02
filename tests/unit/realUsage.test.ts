import { describe, it, expect } from 'vitest'
import { pruneRealUsage, reduceReal } from '@renderer/state/realUsage'
import type { RealUsage } from '@shared/usageReal'

const real = (o: Partial<RealUsage> = {}): RealUsage => ({
  fiveHour: { pct: 6, resetsAt: 2000 },
  sevenDay: { pct: 28, resetsAt: 9000 },
  updatedAt: 500,
  capturedAt: 600,
  contextPct: 29,
  model: 'Opus',
  costUsd: 1,
  ...o
})

describe('pruneRealUsage', () => {
  it('keeps object identity while nothing expired and passes null through', () => {
    const r = real()
    expect(pruneRealUsage(r, 1000)).toBe(r)
    expect(pruneRealUsage(null, 1000)).toBeNull()
  })
  it('drops a window at its reset time, keeps the other', () => {
    const p = pruneRealUsage(real(), 2000)!
    expect(p.fiveHour).toBeNull()
    expect(p.sevenDay).toEqual({ pct: 28, resetsAt: 9000 })
    expect(pruneRealUsage(real(), 9000)!.sevenDay).toBeNull()
  })
})

describe('reduceReal', () => {
  it('keeps the previous object when the new value is equal', () => {
    const a = real()
    expect(reduceReal(a, structuredClone(a))).toBe(a)
  })
  it('takes the new value when anything differs', () => {
    const a = real()
    const b = real({ fiveHour: { pct: 7, resetsAt: 2000 } })
    expect(reduceReal(a, b)).toBe(b)
    expect(reduceReal(a, real({ costUsd: 2 }))).not.toBe(a)
  })
  it('handles null on either side', () => {
    const a = real()
    expect(reduceReal(null, a)).toBe(a)
    expect(reduceReal(a, null)).toBeNull()
    expect(reduceReal(null, null)).toBeNull()
  })
})
