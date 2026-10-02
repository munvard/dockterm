import { describe, expect, it } from 'vitest'
import { AckBatcher, PtyRouter, utf8Length } from '@renderer/components/terminal/ptyRouter'

describe('PtyRouter', () => {
  it('routes chunks and exits to the claiming pane only', () => {
    const r = new PtyRouter()
    const a: string[] = []
    const b: string[] = []
    r.claim('s1', { data: (d) => a.push(d), exit: (c) => a.push(`exit ${c}`) })
    r.claim('s2', { data: (d) => b.push(d), exit: () => b.push('exit') })
    r.dispatchData({ sessionId: 's1', data: 'x' })
    r.dispatchExit({ sessionId: 's1', exitCode: 3 })
    expect(a).toEqual(['x', 'exit 3'])
    expect(b).toEqual([])
  })

  it('hands unclaimed chunks to waiting panes until they unsubscribe', () => {
    const r = new PtyRouter()
    const seen: string[] = []
    const off = r.wait((e) => seen.push(`${e.sessionId}:${e.data}`))
    r.claim('s1', { data: () => {}, exit: () => {} })
    r.dispatchData({ sessionId: 's1', data: 'claimed' })
    r.dispatchData({ sessionId: 's9', data: 'early' })
    off()
    r.dispatchData({ sessionId: 's9', data: 'late' })
    expect(seen).toEqual(['s9:early'])
  })

  it('releasing a claim stops delivery but never removes a newer claim', () => {
    const r = new PtyRouter()
    const got: string[] = []
    const off1 = r.claim('s1', { data: (d) => got.push(`1${d}`), exit: () => {} })
    r.claim('s1', { data: (d) => got.push(`2${d}`), exit: () => {} })
    off1()
    r.dispatchData({ sessionId: 's1', data: 'x' })
    expect(got).toEqual(['2x'])
  })
})

describe('utf8Length', () => {
  it('matches TextEncoder for ASCII, BMP, astral and lone surrogates', () => {
    const enc = new TextEncoder()
    for (const s of ['', 'abc\r\n', 'é', '✓ ⏺ ─', '😀a😀', '\ud800x', 'x\udc00', '\ud83d']) {
      expect(utf8Length(s)).toBe(enc.encode(s).length)
    }
  })
})

describe('AckBatcher', () => {
  it('sums acks per session into one send on the next macrotask', () => {
    const sent: [string, number][] = []
    const queued: (() => void)[] = []
    const b = new AckBatcher((s, n) => sent.push([s, n]), (fn) => queued.push(fn))
    b.add('s1', 10)
    b.add('s1', 5)
    b.add('s2', 7)
    b.add('s3', 0)
    expect(queued.length).toBe(1)
    expect(sent).toEqual([])
    queued.shift()!()
    expect(sent).toEqual([
      ['s1', 15],
      ['s2', 7]
    ])
    b.add('s1', 1)
    expect(queued.length).toBe(1)
  })

  it('drops the unsent acks of a closed session', () => {
    const sent: [string, number][] = []
    let run = (): void => {}
    const b = new AckBatcher((s, n) => sent.push([s, n]), (fn) => (run = fn))
    b.add('s1', 10)
    b.drop('s1')
    run()
    expect(sent).toEqual([])
  })
})
