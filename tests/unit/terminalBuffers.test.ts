import { describe, it, expect } from 'vitest'
import { capBuffers, mergeBuffers, buffersFor, buffersWithLegacy } from '../../src/main/services/terminalBufferStore'

const buf = (leafId: string, n: number, ns = '/proj') => ({ ns, leafId, data: 'x'.repeat(n) })

describe('capBuffers', () => {
  it('keeps buffers until the total byte budget is exceeded', () => {
    const out = capBuffers([buf('a', 100), buf('b', 100), buf('c', 100)], 250)
    expect(out.map((b) => b.leafId)).toEqual(['a', 'b'])
  })

  it('keeps everything when under budget', () => {
    const out = capBuffers([buf('a', 10), buf('b', 10)], 1000)
    expect(out).toHaveLength(2)
  })

  it('drops oversized single buffers rather than blowing the budget', () => {
    const out = capBuffers([buf('huge', 5000), buf('small', 10)], 1000)
    expect(out.map((b) => b.leafId)).toEqual([])
  })
})

describe('mergeBuffers', () => {
  it('keeps entries from OTHER windows that the fresh save does not mention', () => {
    // A secondary window saving its own single leaf must not wipe out the
    // primary window's leaves it never knew about.
    const primary = [buf('primary-1', 10), buf('primary-2', 10)]
    const secondary = [buf('secondary-1', 10)]
    const out = mergeBuffers(secondary, primary)
    expect(out.map((b) => b.leafId).sort()).toEqual(['primary-1', 'primary-2', 'secondary-1'])
  })

  it('the fresh copy of a leafId wins over the stale on-disk one', () => {
    const out = mergeBuffers([buf('a', 5)], [buf('a', 999)])
    expect(out).toEqual([buf('a', 5)])
  })

  it('orders fresh entries first so capBuffers evicts stale ones before fresh ones', () => {
    const fresh = [buf('fresh', 10)]
    const stale = [buf('stale', 10)]
    expect(mergeBuffers(fresh, stale).map((b) => b.leafId)).toEqual(['fresh', 'stale'])
  })
})

describe('namespaced buffers', () => {
  it('two windows on different projects can reuse a leafId without touching each other', () => {
    const a = [buf('leaf-1', 10, '/proj-a')]
    const b = [buf('leaf-1', 5, '/proj-b')]
    const merged = mergeBuffers(b, a)
    expect(merged).toHaveLength(2)
    expect(buffersFor(merged, '/proj-a')).toEqual([{ leafId: 'leaf-1', data: 'x'.repeat(10) }])
    expect(buffersFor(merged, '/proj-b')).toEqual([{ leafId: 'leaf-1', data: 'x'.repeat(5) }])
  })

  it('a save by one namespace never overwrites another namespace\'s same leafId', () => {
    const existing = [buf('same', 100, '/victim')]
    const merged = mergeBuffers([{ ns: '/attacker', leafId: 'same', data: 'evil' }], existing)
    expect(buffersFor(merged, '/victim')[0].data).toBe('x'.repeat(100))
  })

  it('load returns only the requesting namespace, and nothing for an unknown one', () => {
    const all = [buf('a', 1, '/p1'), buf('b', 1, '/p2'), buf('c', 1, '/p1')]
    expect(buffersFor(all, '/p1').map((b) => b.leafId)).toEqual(['a', 'c'])
    expect(buffersFor(all, '/nope')).toEqual([])
  })

  it('the returned entries do not expose the namespace', () => {
    expect(Object.keys(buffersFor([buf('a', 1)], '/proj')[0]).sort()).toEqual(['data', 'leafId'])
  })
})

describe('buffersWithLegacy', () => {
  it('adds pre-namespace buffers after the window\'s own, own entries win', () => {
    const raw = [
      { ns: '/p', leafId: 'a', data: 'own' },
      { leafId: 'a', data: 'old' },
      { leafId: 'b', data: 'legacy' },
      { ns: '/q', leafId: 'c', data: 'other window' },
      { leafId: 3, data: 'bad' }
    ]
    expect(buffersWithLegacy(raw, '/p')).toEqual([
      { leafId: 'a', data: 'own' },
      { leafId: 'b', data: 'legacy' }
    ])
  })
})
