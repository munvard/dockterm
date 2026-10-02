import { describe, it, expect } from 'vitest'
import { createPtyWriter, splitForWrite } from '@renderer/components/terminal/ptyWriter'

describe('splitForWrite', () => {
  it('splits into chunks and never inside a surrogate pair', () => {
    expect(splitForWrite('abcdefg', 3)).toEqual(['abc', 'def', 'g'])
    const s = 'ab\u{1F600}cd' // the emoji is 2 UTF-16 units at index 2..3
    const parts = splitForWrite(s, 3)
    expect(parts.join('')).toBe(s)
    expect(parts[0]).toBe('ab')
    expect(splitForWrite('', 3)).toEqual([])
  })
})

describe('createPtyWriter', () => {
  it('keeps keys typed during a chunked paste after the paste', async () => {
    const sent: string[] = []
    let release: (() => void) | null = null
    const send = (d: string): Promise<boolean> => {
      sent.push(d)
      return new Promise((r) => (release = () => r(true)))
    }
    const write = createPtyWriter(send, 4)
    write('0123456789') // chunked: 0123 | 4567 | 89
    write('\r') // typed while the paste is still going out
    expect(sent).toEqual(['0123'])
    for (let i = 0; i < 5 && release; i++) {
      const r = release as () => void
      release = null
      r()
      await new Promise((x) => setTimeout(x, 0))
    }
    expect(sent).toEqual(['0123', '4567', '89', '\r'])
  })

  it('sends small writes straight away when nothing is queued', () => {
    const sent: string[] = []
    const write = createPtyWriter((d) => (sent.push(d), Promise.resolve(true)), 4)
    write('a')
    write('b')
    expect(sent).toEqual(['a', 'b'])
  })

  it('drops the rest of the queue once a write fails', async () => {
    const sent: string[] = []
    const write = createPtyWriter((d) => (sent.push(d), Promise.resolve(false)), 2)
    write('abcdef')
    write('x')
    await new Promise((x) => setTimeout(x, 0))
    expect(sent).toEqual(['ab'])
  })
})
