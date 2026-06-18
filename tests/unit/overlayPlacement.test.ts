import { describe, it, expect } from 'vitest'
import { clampToAreas } from '@main/overlayPlacement'

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
