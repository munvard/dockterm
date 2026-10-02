import { describe, it, expect } from 'vitest'
import {
  anchorFromSaved,
  boxAtAnchor,
  canvasAreaFor,
  clampToAreas,
  cursorOverHit,
  frameInCanvas,
  hitRectOnScreen,
  normalizeHit,
  pointNearBox,
  sameRect,
  savedFromAnchor,
  usesCanvas
} from '@main/overlayPlacement'

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

describe('pinned munu anchor', () => {
  it('keeps munu centred on the anchor whatever the box width', () => {
    const a = anchorFromSaved({ x: 500, y: 500 }, 380)
    expect(a).toEqual({ cx: 690, y: 500 })
    expect(boxAtAnchor(a, 240, 200)).toEqual({ x: 570, y: 500, width: 240, height: 200 })
    expect(boxAtAnchor(a, 520, 400)).toEqual({ x: 430, y: 500, width: 520, height: 400 })
  })

  it('round-trips the saved position', () => {
    expect(savedFromAnchor(anchorFromSaved({ x: 812, y: 44 }, 380), 380)).toEqual({ x: 812, y: 44 })
  })
})

describe('canvas platforms', () => {
  const display = {
    bounds: { x: 0, y: 0, width: 3440, height: 1440 },
    workArea: { x: 0, y: 0, width: 3440, height: 1400 }
  }
  it('uses the canvas on Windows and macOS only', () => {
    expect(usesCanvas('win32')).toBe(true)
    expect(usesCanvas('darwin')).toBe(true)
    expect(usesCanvas('linux')).toBe(false)
  })
  it('spans the work area on Windows and the whole display on macOS', () => {
    expect(canvasAreaFor('win32', display)).toEqual(display.workArea)
    expect(canvasAreaFor('darwin', display)).toEqual(display.bounds)
  })
})

describe('munu hit region', () => {
  // munu's box on a second monitor to the right of a 2560 wide primary.
  const box = { x: 2560 + 700, y: 0, width: 300, height: 200 }
  const hit = { x: 100, y: 34, width: 80, height: 64 }

  it('moves with the box, so a drag never needs a new report', () => {
    expect(hitRectOnScreen(box, hit)).toEqual({ x: 3360, y: 34, width: 80, height: 64 })
    expect(hitRectOnScreen({ ...box, x: box.x + 50 }, hit).x).toBe(3410)
  })

  it('is not hit by a cursor drawn where an old zoomed layout would have put munu', () => {
    // The overlay used to inherit the main window's 110 percent zoom, so munu was
    // drawn 10 percent further right than main thought. In real DIPs the rect is exact.
    const rect = hitRectOnScreen({ x: 1658, y: 6, width: 124, height: 100 }, { x: 24, y: 0, width: 76, height: 76 })
    expect(cursorOverHit({ x: 1700, y: 40 }, rect, false)).toBe(true)
    expect(cursorOverHit({ x: 1892, y: 40 }, rect, false)).toBe(false)
  })

  it('enters a few pixels outside the edge and leaves only a little further out', () => {
    const rect = hitRectOnScreen(box, hit)
    const right = rect.x + rect.width
    expect(cursorOverHit({ x: right + 3, y: 60 }, rect, false)).toBe(true)
    expect(cursorOverHit({ x: right + 4, y: 60 }, rect, false)).toBe(false)
    expect(cursorOverHit({ x: right + 10, y: 60 }, rect, true)).toBe(true)
    expect(cursorOverHit({ x: right + 11, y: 60 }, rect, true)).toBe(false)
  })

  it('does not flicker for a cursor resting between the enter and leave edge', () => {
    const rect = hitRectOnScreen(box, hit)
    const p = { x: rect.x + rect.width + 7, y: 60 }
    expect(cursorOverHit(p, rect, false)).toBe(false)
    expect(cursorOverHit(p, rect, true)).toBe(true)
  })

  it('rejects empty or malformed regions from the renderer', () => {
    expect(normalizeHit(null)).toBeNull()
    expect(normalizeHit({ x: 0, y: 0, width: 0, height: 10 })).toBeNull()
    expect(normalizeHit({ x: NaN, y: 0, width: 10, height: 10 })).toBeNull()
    expect(normalizeHit({ x: 4, y: 5, width: 10, height: 12 })).toEqual({ x: 4, y: 5, width: 10, height: 12 })
  })
})
