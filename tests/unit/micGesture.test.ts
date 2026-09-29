import { describe, it, expect } from 'vitest'
import { createMicGesture, MIC_CLICK_MS } from '../../src/renderer/src/components/chat/micGesture'

describe('createMicGesture', () => {
  it('hold: start on press, stop on release', () => {
    let t = 0
    const g = createMicGesture(() => t)
    expect(g.down(false)).toBe('start')
    t = MIC_CLICK_MS
    expect(g.up()).toBe('stop')
  })

  it('short click latches on; the next press stops and its release does nothing', () => {
    let t = 0
    const g = createMicGesture(() => t)
    expect(g.down(false)).toBe('start')
    t = MIC_CLICK_MS - 1
    expect(g.up()).toBe('none')
    t = 5000
    expect(g.down(true)).toBe('stop')
    t = 5400
    expect(g.up()).toBe('none')
  })

  it('a fresh hold after a latched stop works normally', () => {
    let t = 0
    const g = createMicGesture(() => t)
    g.down(false)
    t = 100
    g.up()
    g.down(true)
    g.up()
    t = 1000
    expect(g.down(false)).toBe('start')
    t = 2000
    expect(g.up()).toBe('stop')
  })
})
