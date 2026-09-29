import { describe, it, expect } from 'vitest'
import { countFitting } from '@renderer/components/layout/topBarFit'

describe('countFitting (I6)', () => {
  it('keeps everything when it all fits', () => {
    expect(countFitting([30, 30, 30], 8, 200)).toBe(3)
  })

  it('stops at the first icon that would overflow', () => {
    // 38 + 38 = 76 fits in 80; the third would make 114.
    expect(countFitting([30, 30, 30], 8, 80)).toBe(2)
  })

  it('hides all of them when there is no room', () => {
    expect(countFitting([30, 30], 8, 10)).toBe(0)
  })
})
