import { describe, it, expect } from 'vitest'
import { setActiveRoot, getActiveRoot, clearActiveRoot } from '@main/services/activeRoot'

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
