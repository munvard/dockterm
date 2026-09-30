import { describe, it, expect } from 'vitest'
import { clampToAreas, frameInCanvas, pointNearBox, sameRect } from '@main/overlayPlacement'

const area = { x: 0, y: 0, width: 1000, height: 800 }

describe('clampToAreas', () => {
  it('leaves an in-bounds box untouched', () => {
    expect(clampToAreas({ x: 100, y: 100, width: 200, height: 150 }, [area])).toEqual({ x: 100, y: 100 })
  })
  it('pulls a box back inside the right/bottom edges', () => {
    expect(clampToAreas({ x: 950, y: 760, width: 200, height: 150 }, [area])).toEqual({ x: 800, y: 650 })
  })
  it('pulls a box back inside the top/left edges', () => {
    expect(clampToAreas({ x: -50, y: -30, width: 200, height: 150 }, [area])).toEqual({ x: 0, y: 0 })
  })
  it('clamps to the nearest area when multiple displays exist', () => {
    const second = { x: 1000, y: 0, width: 1000, height: 800 }
    // Box centered on the second display clamps within it, not the first.
    expect(clampToAreas({ x: 1900, y: 100, width: 200, height: 150 }, [area, second])).toEqual({
      x: 1800,
      y: 100
    })
  })
})

describe('overlay canvas (Windows)', () => {
  const canvas = { x: 1920, y: 0, width: 2560, height: 1400 }

  it('maps munu into the canvas window coordinates', () => {
    expect(frameInCanvas({ x: 2000, y: 300, width: 380, height: 260 }, canvas)).toEqual({
      x: 80,
      y: 300,
      width: 380,
      height: 260
    })
  })

  it('only treats an identical work area as the same canvas', () => {
    expect(sameRect(null, canvas)).toBe(false)
    expect(sameRect({ ...canvas }, canvas)).toBe(true)
    expect(sameRect({ ...canvas, height: 1360 }, canvas)).toBe(false)
  })

  it('treats the cursor as near munu only inside the box plus the margin', () => {
    const b = { x: 500, y: 500, width: 200, height: 100 }
    expect(pointNearBox({ x: 600, y: 550 }, b, 48)).toBe(true)
    expect(pointNearBox({ x: 740, y: 640 }, b, 48)).toBe(true)
    expect(pointNearBox({ x: 760, y: 550 }, b, 48)).toBe(false)
    expect(pointNearBox({ x: 600, y: 420 }, b, 48)).toBe(false)
  })
})
