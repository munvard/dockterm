import { describe, it, expect } from 'vitest'
import { wrapBracketedPaste, clampToolbar } from '../../src/renderer/src/components/terminal/terminalSelection'

describe('wrapBracketedPaste', () => {
  it('wraps text in bracketed-paste markers so multi-line lands unsubmitted', () => {
    expect(wrapBracketedPaste('a\nb')).toBe('\x1b[200~a\nb\x1b[201~')
  })
})

describe('clampToolbar', () => {
  const size = { w: 160, h: 28 }
  const vp = { w: 1000, h: 800 }

  it('centers the toolbar above the anchor when there is room', () => {
    const p = clampToolbar({ x: 500, y: 400 }, size, vp)
    expect(p.x).toBe(500 - 80) // centered
    expect(p.y).toBe(400 - 28 - 8) // above by height + gap
  })

  it('flips below the anchor when too close to the top', () => {
    const p = clampToolbar({ x: 500, y: 10 }, size, vp)
    expect(p.y).toBe(10 + 8) // below the anchor
  })

  it('clamps to the right edge', () => {
    const p = clampToolbar({ x: 995, y: 400 }, size, vp)
    expect(p.x).toBe(vp.w - size.w - 8)
  })

  it('clamps to the left edge', () => {
    const p = clampToolbar({ x: 2, y: 400 }, size, vp)
    expect(p.x).toBe(8)
  })
})
