import { describe, it, expect } from 'vitest'
import { planTopBar, MIN_DRAG_GAP, NAME_MIN, type TopBarMeasure } from '@renderer/components/layout/topBarFit'

// A bar like the real one at 100% zoom: 26 px icon buttons, 8 px gaps.
const base = (avail: number, over: Partial<TopBarMeasure> = {}): TopBarMeasure => ({
  avail,
  gap: 8,
  minDrag: MIN_DRAG_GAP,
  leftFixed: [26, 26],
  name: 120,
  nameMin: NAME_MIN,
  branch: 150,
  branchIcon: 16,
  sync: null,
  chip: 80,
  chipShort: 30,
  agent: null,
  pill: 100,
  pillCompact: 60,
  panels: [26, 26, 26, 26, 26, 26, 26, 26, 26, 26],
  more: 26,
  rightFixed: [1, 26, 26, 26, 26],
  ...over
})

// Full width of the base bar: left 26+26+120+150+80 + 4 gaps = 434; right 100 + panels
// (10*26 + 9*8 = 332) + 1 + 4*26 + 6 gaps = 585. Total 1019.
const FULL = 1019

describe('planTopBar', () => {
  it('keeps everything when there is room for it and the drag gap', () => {
    const p = planTopBar(base(FULL + MIN_DRAG_GAP))
    expect(p).toMatchObject({ chipShort: false, nameWidth: null, branch: 'full', pillCompact: false, panels: 10 })
    expect(p.free).toBe(MIN_DRAG_GAP)
  })

  it('first shortens the changed chip to its count', () => {
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 10))
    expect(p).toMatchObject({ chipShort: true, nameWidth: null, branch: 'full', panels: 10 })
  })

  it('then truncates the project name only as far as needed', () => {
    // The chip saves 50; 20 more must come from the name (120 -> 100).
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 70))
    expect(p).toMatchObject({ chipShort: true, nameWidth: 100, branch: 'full', pillCompact: false, panels: 10 })
    expect(p.free).toBe(MIN_DRAG_GAP)
  })

  it('shrinks the branch to its icon before touching the usage pill, and gives slack back to the name', () => {
    // Chip 50 + name 48 = 98 is not enough for 110; the branch icon frees 134 more.
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 110))
    expect(p.branch).toBe('icon')
    expect(p.pillCompact).toBe(false)
    expect(p.nameWidth).toBe(null)
    expect(p.free).toBeGreaterThanOrEqual(MIN_DRAG_GAP)
  })

  it('drops the reset countdown from the pill before any panel icon collapses', () => {
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 50 - 48 - 134 - 20))
    expect(p).toMatchObject({ branch: 'icon', pillCompact: true, panels: 10 })
  })

  it('collapses panel icons from the end, counting the "more" button it adds', () => {
    // After the chip, name, branch and pill steps free 272 px, 30 more are needed:
    // hiding one icon frees 34 but "more" costs 34, so two must go.
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 272 - 30))
    expect(p.pillCompact).toBe(true)
    expect(p.panels).toBe(8)
    expect(p.free).toBeGreaterThanOrEqual(MIN_DRAG_GAP)
  })

  it('keeps a free drag gap at a narrow window by hiding the name and branch last', () => {
    const p = planTopBar(base(420))
    expect(p.panels).toBe(0)
    expect(p.nameWidth).toBe(0)
    expect(p.free).toBeGreaterThanOrEqual(MIN_DRAG_GAP)
  })

  it('never invents items that are not rendered', () => {
    const p = planTopBar(base(300, { name: null, branch: null, chip: null, pill: null }))
    expect(p.nameWidth).toBe(null)
    expect(p.branch).toBe('full')
  })

  it('a short name is never widened past its natural width', () => {
    const p = planTopBar(base(FULL + MIN_DRAG_GAP - 200, { name: 40 }))
    expect(p.nameWidth === null || p.nameWidth <= 40).toBe(true)
  })
})
