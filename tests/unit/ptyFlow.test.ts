import { describe, it, expect } from 'vitest'
import { PtyFlow } from '@main/services/ptyFlow'
import { PTY } from '@shared/constants'

describe('PtyFlow', () => {
  it('signals a flush only once buffered bytes meet the threshold', () => {
    const f = new PtyFlow()
    expect(f.push('a'.repeat(PTY.FLUSH_BYTES - 1))).toBe(false)
    expect(f.push('bb')).toBe(true)
  })

  it('drain concatenates and clears the buffer', () => {
    const f = new PtyFlow()
    f.push('hello ')
    f.push('world')
    expect(f.hasBuffered).toBe(true)
    expect(f.drain()).toBe('hello world')
    expect(f.hasBuffered).toBe(false)
    expect(f.drain()).toBe('')
  })

  it('pauses past the high-water mark and resumes under the low-water mark', () => {
    const f = new PtyFlow()
    expect(f.onSent(PTY.HIGH_WATER - 1)).toBe(false)
    expect(f.isPaused).toBe(false)
    expect(f.onSent(2)).toBe(true)
    expect(f.isPaused).toBe(true)
    expect(f.onAck(PTY.HIGH_WATER)).toBe(true)
    expect(f.isPaused).toBe(false)
  })

  it('never lets unacknowledged bytes go negative', () => {
    const f = new PtyFlow()
    f.onSent(10)
    expect(f.onAck(999)).toBe(false)
    expect(f.isPaused).toBe(false)
  })
})
