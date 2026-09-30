import { describe, it, expect } from 'vitest'
import { classify } from '@renderer/components/terminal/claudeStatus'
import { createStatusHold, IDLE_HOLD_MS } from '@renderer/components/terminal/statusHold'

describe('classify: every spinner frame reads as working', () => {
  it('accepts a no-break space after the spinner (Windows)', () => {
    expect(classify('✻ Thinking… (3s · ↓ 12 tokens)')).toBe('working')
  })
  it('accepts the * frame of the spinner', () => {
    expect(classify('* Thinking… (3s · ↓ 12 tokens)')).toBe('working')
    expect(classify('* Pondering… (1s)')).toBe('working')
  })
  it('does not take a markdown bullet with an ellipsis for the spinner', () => {
    expect(classify('* then we wait…')).toBe('idle')
  })
})

describe('createStatusHold', () => {
  it('keeps working through a short idle blip, and never delays other changes', () => {
    const hold = createStatusHold()
    expect(hold('working', 0)).toEqual({ state: 'working' })
    expect(hold('idle', 100)).toEqual({ state: 'working', recheckIn: IDLE_HOLD_MS })
    expect(hold('working', 300)).toEqual({ state: 'working' })
    expect(hold('asking', 400)).toEqual({ state: 'asking' })
    expect(hold('idle', 500)).toEqual({ state: 'idle' })
  })
  it('drops to idle once idle has held long enough', () => {
    const hold = createStatusHold()
    hold('working', 0)
    expect(hold('idle', 1000).state).toBe('working')
    expect(hold('idle', 1000 + IDLE_HOLD_MS / 2)).toEqual({ state: 'working', recheckIn: IDLE_HOLD_MS / 2 })
    expect(hold('idle', 1000 + IDLE_HOLD_MS)).toEqual({ state: 'idle' })
    expect(hold('idle', 5000)).toEqual({ state: 'idle' })
  })
})
