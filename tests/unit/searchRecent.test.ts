import { describe, expect, it } from 'vitest'
import { pushRecentList } from '../../src/renderer/src/state/useSearchStore'

describe('pushRecentList', () => {
  it('puts the newest first and drops the older copy', () => {
    expect(pushRecentList(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecentList([], 'a')).toEqual(['a'])
  })
  it('caps the list', () => {
    const many = Array.from({ length: 80 }, (_, i) => `f${i}`)
    const out = pushRecentList(many, 'new')
    expect(out.length).toBe(40)
    expect(out[0]).toBe('new')
  })
})
