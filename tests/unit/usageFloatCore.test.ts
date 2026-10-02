import { describe, it, expect } from 'vitest'
import {
  FLOAT_MIN_H,
  FLOAT_MIN_W,
  clampFloatBounds,
  defaultFloatBounds,
  floatViewPatchSchema,
  sameBox
} from '@main/usageFloatCore'

const main = { x: 0, y: 0, width: 1440, height: 900 }
const second = { x: 1440, y: 0, width: 1920, height: 1080 }

describe('clampFloatBounds', () => {
  it('uses the primary top-right corner when there is no saved position', () => {
    const b = clampFloatBounds({ x: null, y: null, w: 260, h: 120 }, [main], main)
    expect(b.width).toBe(260)
    expect(b.x + b.width).toBeLessThan(main.width)
    expect(b.x).toBeGreaterThan(main.width / 2)
    expect(b).toEqual(defaultFloatBounds(main, 260, 120))
  })
  it('keeps a window that is already on screen exactly where it is', () => {
    expect(clampFloatBounds({ x: 100, y: 120, w: 260, h: 120 }, [main], main)).toEqual({
      x: 100,
      y: 120,
      width: 260,
      height: 120
    })
  })
  it('pulls a window back when its display was unplugged', () => {
    const b = clampFloatBounds({ x: 2000, y: 300, w: 260, h: 120 }, [main], main)
    expect(b.x + b.width).toBeLessThanOrEqual(main.width)
    expect(b.y).toBe(300)
  })
  it('keeps a window on the second display when it exists', () => {
    const b = clampFloatBounds({ x: 2000, y: 300, w: 260, h: 120 }, [main, second], main)
    expect(b.x).toBe(2000)
  })
  it('enforces the minimum size and limits the size to the display', () => {
    const small = clampFloatBounds({ x: 10, y: 10, w: 50, h: 20 }, [main], main)
    expect([small.width, small.height]).toEqual([FLOAT_MIN_W, FLOAT_MIN_H])
    const huge = clampFloatBounds({ x: 10, y: 10, w: 5000, h: 5000 }, [main], main)
    expect([huge.width, huge.height]).toEqual([1440, 900])
  })
})

describe('sameBox and the patch schema', () => {
  it('compares boxes by value', () => {
    expect(sameBox({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true)
    expect(sameBox({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false)
  })
  it('lets the widget change only what it shows, never place, size or enabled', () => {
    expect(floatViewPatchSchema.safeParse({ style: 'ring', opacity: 0.5 }).success).toBe(true)
    expect(floatViewPatchSchema.safeParse({ opacity: 0.1 }).success).toBe(false)
    expect(floatViewPatchSchema.safeParse({ show: [] }).success).toBe(false)
    expect(floatViewPatchSchema.safeParse({ x: 5 }).success).toBe(false)
    expect(floatViewPatchSchema.safeParse({ enabled: false }).success).toBe(false)
  })
})
