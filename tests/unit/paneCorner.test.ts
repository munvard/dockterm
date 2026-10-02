import { describe, expect, it } from 'vitest'
import { CornerHold, cornerBlank, coveredCells } from '@renderer/components/terminal/paneCorner'

describe('coveredCells', () => {
  const screen = { left: 0, top: 0, right: 800, bottom: 400 } // 100 x 25 grid of 8 x 16 cells

  it('counts the columns from the right edge and rows from the top under the box', () => {
    expect(coveredCells({ left: 600, top: 5, right: 793, bottom: 42 }, screen, 100, 25)).toEqual({
      cols: 25,
      rows: 3
    })
  })

  it('clamps a box larger than the grid and ignores a box outside it', () => {
    expect(coveredCells({ left: -50, top: 0, right: 900, bottom: 900 }, screen, 100, 25)).toEqual({
      cols: 100,
      rows: 25
    })
    expect(coveredCells({ left: 810, top: 0, right: 900, bottom: 30 }, screen, 100, 25)).toEqual({
      cols: 0,
      rows: 0
    })
    expect(coveredCells({ left: 600, top: 0, right: 790, bottom: 30 }, screen, 0, 25)).toEqual({
      cols: 0,
      rows: 0
    })
  })

  it('accounts for a grid offset inside the pane', () => {
    const inset = { left: 10, top: 20, right: 810, bottom: 420 }
    expect(coveredCells({ left: 794, top: 5, right: 805, bottom: 36 }, inset, 100, 25)).toEqual({
      cols: 2,
      rows: 1
    })
  })
})

describe('cornerBlank', () => {
  it('is blank only when every covered cell is a space', () => {
    expect(cornerBlank(['    ', '', '  '])).toBe(true)
    expect(cornerBlank(['    ', ' ✕ '])).toBe(false)
  })
})

describe('CornerHold', () => {
  it('hides at once when the corner fills and shows again only after it stays clear', () => {
    const h = new CornerHold(1000)
    expect(h.update(true, 0)).toEqual({ busy: false })
    expect(h.update(false, 100)).toEqual({ busy: true })
    expect(h.update(true, 200)).toEqual({ busy: true, recheckIn: 1000 })
    expect(h.update(true, 700)).toEqual({ busy: true, recheckIn: 500 })
    expect(h.update(true, 1200)).toEqual({ busy: false })
  })

  it('restarts the clear wait when content comes back', () => {
    const h = new CornerHold(1000)
    h.update(false, 0)
    h.update(true, 100)
    h.update(false, 900)
    expect(h.update(true, 1200)).toEqual({ busy: true, recheckIn: 1000 })
  })
})
