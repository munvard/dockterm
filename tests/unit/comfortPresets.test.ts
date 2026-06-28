import { describe, it, expect } from 'vitest'
import {
  readingWidthToMax,
  matchPreset,
  COMFORT_PRESETS
} from '../../src/renderer/src/components/terminal/comfortPresets'

describe('readingWidthToMax', () => {
  it('maps each width to px, off → null', () => {
    expect(readingWidthToMax('off')).toBeNull()
    expect(readingWidthToMax('narrow')).toBe(680)
    expect(readingWidthToMax('medium')).toBe(860)
    expect(readingWidthToMax('wide')).toBe(1100)
  })
})

describe('matchPreset', () => {
  it('identifies each preset from its exact values', () => {
    expect(matchPreset(COMFORT_PRESETS.off)).toBe('off')
    expect(matchPreset(COMFORT_PRESETS.cozy)).toBe('cozy')
    expect(matchPreset(COMFORT_PRESETS.relaxed)).toBe('relaxed')
  })
  it('returns "custom" when any knob differs', () => {
    expect(matchPreset({ ...COMFORT_PRESETS.cozy, padding: 16 })).toBe('custom')
    expect(matchPreset({ ...COMFORT_PRESETS.off, lineHeight: 1.4 })).toBe('custom')
  })
})
