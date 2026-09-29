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

  it('writes the bracketed-paste chunk immediately and Enter ~70ms later, never in the same write', async () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => true
    })

    const done = sendPrompt('leaf-1', 'hello claude')
    expect(writes).toEqual(['\x1b[200~hello claude\x1b[201~'])

    vi.advanceTimersByTime(69)
    expect(writes).toHaveLength(1) // Enter hasn't landed yet

    vi.advanceTimersByTime(1)
    expect(writes).toEqual(['\x1b[200~hello claude\x1b[201~', '\r'])
    await expect(done).resolves.toBe(true)
  })

  it('returns false and writes nothing for an empty prompt', async () => {
    const writes: string[] = []
    paneWriters.register('leaf-1', {
      write: (text) => writes.push(text),
      paste: () => {},
      bracketedPaste: () => true
    })
    await expect(sendPrompt('leaf-1', '')).resolves.toBe(false)
    expect(writes).toEqual([])
  })

  it('returns false when the pane has no registered writer (already closed)', async () => {
    await expect(sendPrompt('no-such-leaf', 'hi')).resolves.toBe(false)
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

  it('returns false when nothing but control characters is left', async () => {
    paneWriters.register('leaf-1', { write: () => {}, paste: () => {}, bracketedPaste: () => true })
    await expect(sendPrompt('leaf-1', '\x1b\x07')).resolves.toBe(false)
  })
})

describe('sendPrompt image-only send', () => {
  it('still sends a lone space (images were pasted first)', async () => {
    vi.useFakeTimers()
    const writes: string[] = []
    paneWriters.register('leaf-1', { write: (t) => writes.push(t), paste: () => {}, bracketedPaste: () => true })
    const done = sendPrompt('leaf-1', ' ')
    await vi.advanceTimersByTimeAsync(70)
    await expect(done).resolves.toBe(true)
    vi.useRealTimers()
    paneWriters.unregister('leaf-1')
  })
})

describe('sendPrompt guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    paneWriters.unregister('leaf-1')
  })

  function reg(): string[] {
    const writes: string[] = []
    paneWriters.register('leaf-1', { write: (t) => writes.push(t), paste: () => {}, bracketedPaste: () => true })
    return writes
  }

  it('writes nothing when the guard says Claude is not there', async () => {
    const writes = reg()
    const done = sendPrompt('leaf-1', 'hi', async () => false)
    await vi.advanceTimersByTimeAsync(200)
    await expect(done).resolves.toBe(false)
    expect(writes).toEqual([])
  })

  it('skips Enter and reports false when Claude goes away between the paste and Enter', async () => {
    const writes = reg()
    let n = 0
    const done = sendPrompt('leaf-1', 'hi', async () => ++n === 1)
    await vi.advanceTimersByTimeAsync(200)
    await expect(done).resolves.toBe(false)
    expect(writes).toEqual(['\x1b[200~hi\x1b[201~'])
  })

  it('reports false when the pane closes before Enter (writer gone)', async () => {
    reg()
    const done = sendPrompt('leaf-1', 'hi')
    paneWriters.unregister('leaf-1')
    await vi.advanceTimersByTimeAsync(100)
    await expect(done).resolves.toBe(false)
  })
})
