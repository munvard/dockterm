import { describe, it, expect } from 'vitest'
import {
  setActiveRoot,
  getActiveRoot,
  clearActiveRoot,
  rememberKnownRoot,
  isKnownRoot
} from '@main/services/activeRoot'

describe('activeRoot registry', () => {
  it('stores and returns a root per webContents id', () => {
    setActiveRoot(1, '/a')
    setActiveRoot(2, '/b')
    expect(getActiveRoot(1)).toBe('/a')
    expect(getActiveRoot(2)).toBe('/b')
  })

  it('throws when no root is set for an id', () => {
    expect(() => getActiveRoot(999)).toThrow(/no active project/i)
  })

  it('clears a webContents entry', () => {
    setActiveRoot(3, '/c')
    clearActiveRoot(3)
    expect(() => getActiveRoot(3)).toThrow()
  })
})

describe('known-root validation (RU-C3)', () => {
  it('is unknown before it is ever remembered', () => {
    expect(isKnownRoot(501, '/never-seen')).toBe(false)
  })

  it('becomes known once remembered, scoped to its webContents id', () => {
    rememberKnownRoot(502, '/project-a')
    expect(isKnownRoot(502, '/project-a')).toBe(true)
    // A different window's id never sees another window's known roots.
    expect(isKnownRoot(503, '/project-a')).toBe(false)
  })

  it('accumulates multiple roots for the same window instead of replacing', () => {
    rememberKnownRoot(504, '/project-a')
    rememberKnownRoot(504, '/project-b')
    expect(isKnownRoot(504, '/project-a')).toBe(true)
    expect(isKnownRoot(504, '/project-b')).toBe(true)
    expect(isKnownRoot(504, '/project-c')).toBe(false)
  })
})

describe('clearActiveRoot forgets the window entirely (Codex 13)', () => {
  it('drops the known roots together with the active root', () => {
    setActiveRoot(41, '/a')
    rememberKnownRoot(41, '/a')
    rememberKnownRoot(41, '/b')
    clearActiveRoot(41)
    expect(isKnownRoot(41, '/a')).toBe(false)
    expect(isKnownRoot(41, '/b')).toBe(false)
  })

  it('leaves other windows alone', () => {
    rememberKnownRoot(42, '/x')
    rememberKnownRoot(43, '/x')
    clearActiveRoot(42)
    expect(isKnownRoot(43, '/x')).toBe(true)
  })
})
