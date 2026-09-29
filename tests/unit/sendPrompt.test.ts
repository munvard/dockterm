import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendPrompt } from '../../src/renderer/src/state/sendPrompt'
import { paneWriters } from '../../src/renderer/src/state/paneWriters'

describe('sendPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    paneWriters.unregister('leaf-1')
  })

  it('writes the bracketed-paste chunk immediately and Enter ~70ms later, never in the same write', () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', (text) => writes.push(text))

    const ok = sendPrompt('leaf-1', 'hello claude')
    expect(ok).toBe(true)
    expect(writes).toEqual(['\x1b[200~hello claude\x1b[201~'])

    vi.advanceTimersByTime(69)
    expect(writes).toHaveLength(1) // Enter hasn't landed yet

    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['\x1b[200~hello claude\x1b[201~', '\r'])
  })

  it('returns false and writes nothing for an empty prompt', () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', (text) => writes.push(text))
    expect(sendPrompt('leaf-1', '')).toBe(false)
    expect(writes).toEqual([])
  })

  it('returns false when the pane has no registered writer (already closed)', () => {
    expect(sendPrompt('no-such-leaf', 'hi')).toBe(false)
  })
})
