import { describe, it, expect } from 'vitest'
import { capBuffers } from '../../src/main/services/terminalBufferStore'

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
