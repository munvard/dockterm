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
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => true
    })

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
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => true
    })
    expect(sendPrompt('leaf-1', '')).toBe(false)
    expect(writes).toEqual([])
  })

  it('returns false when the pane has no registered writer (already closed)', () => {
    expect(sendPrompt('no-such-leaf', 'hi')).toBe(false)
  })
})

describe('sendPrompt paste safety', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    paneWriters.unregister('leaf-1')
  })

  it('cannot end the bracketed paste early: ESC is stripped from the payload', () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => true
    })
    sendPrompt('leaf-1', 'hi\x1b[201~rm -rf ~\r')
    expect(writes).toHaveLength(1)
    const body = writes[0].slice('\x1b[200~'.length, -'\x1b[201~'.length)
    expect(body).not.toContain('\x1b')
    expect(writes[0].startsWith('\x1b[200~')).toBe(true)
    expect(writes[0].endsWith('\x1b[201~')).toBe(true)
    expect(writes[0].split('\x1b[201~')).toHaveLength(2)
    expect(writes[0]).not.toContain('\r')
  })

  it('strips control characters without bracketed paste too, keeps newline and tab', () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => false
    })
    sendPrompt('leaf-1', 'a\tb\nc\x07\x1b[31m\x9b')
    expect(writes[0]).toBe('a\tb\nc[31m')
  })

  it('returns false when nothing but control characters is left', () => {
    paneWriters.register('leaf-1', { write: () => {}, paste: () => {}, bracketedPaste: () => true })
    expect(sendPrompt('leaf-1', '\x1b\x07')).toBe(false)
  })
})

describe('sendPrompt image-only send', () => {
  it('still sends a lone space (images were pasted first)', () => {
    vi.useFakeTimers()
    const writes: string[] = []
    paneWriters.register('leaf-1', { write: (t) => writes.push(t), paste: () => {}, bracketedPaste: () => true })
    expect(sendPrompt('leaf-1', ' ')).toBe(true)
    vi.useRealTimers()
    paneWriters.unregister('leaf-1')
  })
})
