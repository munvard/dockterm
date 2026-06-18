import { describe, it, expect } from 'vitest'
import { wantReveal } from '@main/services/munuReveal'

const base = { pinned: false, cursorInZone: false, hasUnseenAsk: false, peekActive: false }

describe('wantReveal', () => {
  it('hidden when nothing applies', () => {
    expect(wantReveal(base)).toBe(false)
  })
  it('always revealed when pinned', () => {
    expect(wantReveal({ ...base, pinned: true })).toBe(true)
  })
  it('revealed for an unseen ask', () => {
    expect(wantReveal({ ...base, hasUnseenAsk: true })).toBe(true)
  })
  it('revealed while the cursor is in the zone or a peek is active', () => {
    expect(wantReveal({ ...base, cursorInZone: true })).toBe(true)
    expect(wantReveal({ ...base, peekActive: true })).toBe(true)
  })
})
