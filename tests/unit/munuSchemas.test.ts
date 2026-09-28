import { describe, it, expect } from 'vitest'
import { coord, dragSchema, askSchema } from '@main/ipc/handlers/munu'

describe('munu IPC schema bounds', () => {
  it('coord (used by drag/move) rejects Infinity and NaN', () => {
    expect(coord.safeParse(Infinity).success).toBe(false)
    expect(coord.safeParse(-Infinity).success).toBe(false)
    expect(coord.safeParse(NaN).success).toBe(false)
    expect(coord.safeParse(42).success).toBe(true)
  })

  it('dragSchema rejects a non-finite sx/sy', () => {
    expect(dragSchema.safeParse({ sx: Infinity, sy: 0 }).success).toBe(false)
    expect(dragSchema.safeParse({ sx: 0, sy: 0 }).success).toBe(true)
  })

  it('askSchema caps title/option/description/label string length', () => {
    const huge = 'x'.repeat(100_000)
    const base = {
      leafId: 'leaf1',
      tabId: 'tab1',
      title: null,
      options: [],
      descriptions: [],
      steps: [],
      binary: false,
      multiSelect: false,
      checkable: [],
      checked: [],
      submitIndex: null,
      cursorRow: 0,
      visible: true
    }
    expect(askSchema.safeParse({ ...base, title: huge }).success).toBe(false)
    expect(askSchema.safeParse({ ...base, options: [huge] }).success).toBe(false)
    expect(askSchema.safeParse({ ...base, steps: [{ label: huge, done: false }] }).success).toBe(false)
    expect(askSchema.safeParse(base).success).toBe(true)
  })

  it('askSchema caps leafId/tabId id length', () => {
    const base = {
      leafId: 'x'.repeat(10_000),
      tabId: 'tab1',
      title: null,
      options: [],
      descriptions: [],
      steps: [],
      binary: false,
      multiSelect: false,
      checkable: [],
      checked: [],
      submitIndex: null,
      cursorRow: 0,
      visible: true
    }
    expect(askSchema.safeParse(base).success).toBe(false)
  })
})
