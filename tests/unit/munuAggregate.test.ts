import { describe, it, expect } from 'vitest'
import { aggregate, type MunuState } from '@renderer/state/munuAggregate'

const s = (...states: MunuState[]): MunuState[] => states

describe('aggregate', () => {
  it('asking beats working beats idle', () => {
    expect(aggregate(s('idle', 'working', 'asking'))).toBe('asking')
    expect(aggregate(s('idle', 'working'))).toBe('working')
    expect(aggregate(s('idle', 'idle'))).toBe('idle')
  })
  it('done beats everything when present', () => {
    expect(aggregate(s('working', 'done', 'asking'))).toBe('done')
  })
  it('empty → idle', () => {
    expect(aggregate([])).toBe('idle')
  })
})
