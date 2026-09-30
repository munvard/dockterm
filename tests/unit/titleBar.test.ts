import { describe, it, expect } from 'vitest'
import { chromeOptions, HEX_COLOR, TITLEBAR_HEIGHT } from '@main/titleBar'

describe('chromeOptions (F9)', () => {
  it('win32 hides the native title bar and overlays the caption buttons at app-bar height', () => {
    const o = chromeOptions('win32')
    expect(o.titleBarStyle).toBe('hidden')
    expect(o.titleBarOverlay).toMatchObject({ height: TITLEBAR_HEIGHT })
    expect(TITLEBAR_HEIGHT).toBe(36)
  })

  it('macOS keeps hiddenInset with traffic lights and vibrancy, unchanged', () => {
    expect(chromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 13 },
      vibrancy: 'under-window',
      visualEffectState: 'active'
    })
  })

  it('linux keeps the native frame', () => {
    expect(chromeOptions('linux')).toEqual({})
  })

  it('only #rrggbb colours are accepted for the overlay', () => {
    expect(HEX_COLOR.test('#1e1e1d')).toBe(true)
    expect(HEX_COLOR.test('red')).toBe(false)
    expect(HEX_COLOR.test('rgba(0,0,0,1)')).toBe(false)
  })
})
