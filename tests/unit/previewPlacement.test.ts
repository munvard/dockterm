import { describe, it, expect } from 'vitest'
import { placePreview } from '../../src/renderer/src/components/terminal/terminalSelection'

describe('placePreview', () => {
  const size = { w: 380, h: 300 }
  const vp = { w: 1200, h: 800 }

  it('places the card below-right of the cursor when there is room', () => {
    const p = placePreview({ x: 400, y: 300 }, size, vp)
    expect(p.x).toBe(400 + 14)
    expect(p.y).toBe(300 + 14)
  })

  it('flips to the left when it would overflow the right edge', () => {
    const p = placePreview({ x: 1150, y: 300 }, size, vp)
    expect(p.x).toBe(1150 - 14 - size.w)
  })

  it('flips above when it would overflow the bottom edge', () => {
    const p = placePreview({ x: 400, y: 780 }, size, vp)
    expect(p.y).toBe(780 - 14 - size.h)
  })

  it('clamps within the viewport so the card never leaves the screen', () => {
    const p = placePreview({ x: 5, y: 5 }, size, vp)
    expect(p.x).toBeGreaterThanOrEqual(14)
    expect(p.y).toBeGreaterThanOrEqual(14)
    expect(p.x + size.w).toBeLessThanOrEqual(vp.w - 14)
    expect(p.y + size.h).toBeLessThanOrEqual(vp.h - 14)
  })
})
