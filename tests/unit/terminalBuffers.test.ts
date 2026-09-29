import { describe, it, expect } from 'vitest'
import { capBuffers, mergeBuffers } from '../../src/main/services/terminalBufferStore'

const buf = (leafId: string, n: number) => ({ leafId, data: 'x'.repeat(n) })

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
