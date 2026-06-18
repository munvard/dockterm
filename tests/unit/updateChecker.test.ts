import { describe, it, expect } from 'vitest'
import { isNewer } from '@main/services/updateChecker'

describe('isNewer (update version compare)', () => {
  it('detects a higher version', () => {
    expect(isNewer('0.22.0', '0.21.0')).toBe(true)
    expect(isNewer('1.0.0', '0.21.0')).toBe(true)
    expect(isNewer('0.21.1', '0.21.0')).toBe(true)
    expect(isNewer('0.21.10', '0.21.9')).toBe(true)
  })
  it('rejects same or older', () => {
    expect(isNewer('0.21.0', '0.21.0')).toBe(false)
    expect(isNewer('0.20.5', '0.21.0')).toBe(false)
    expect(isNewer('0.9.9', '0.21.0')).toBe(false)
  })
  it('tolerates a leading v', () => {
    expect(isNewer('v0.22.0', '0.21.0')).toBe(true)
    expect(isNewer('v0.21.0', 'v0.21.0')).toBe(false)
  })
})
