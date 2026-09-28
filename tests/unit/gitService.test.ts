import os from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isSuspiciouslyBroadToplevel } from '@main/services/gitService'

describe('isSuspiciouslyBroadToplevel', () => {
  it('is true when the discovered toplevel IS home', () => {
    expect(isSuspiciouslyBroadToplevel(os.homedir())).toBe(true)
  })

  it('is true when the discovered toplevel is an ancestor of home', () => {
    expect(isSuspiciouslyBroadToplevel(join(os.homedir(), '..'))).toBe(true)
  })

  it('is false for an ordinary project repo under home', () => {
    expect(isSuspiciouslyBroadToplevel(join(os.homedir(), 'projects', 'app'))).toBe(false)
  })

  it('is false for a project repo entirely outside home', () => {
    expect(isSuspiciouslyBroadToplevel(join('/srv', 'app'))).toBe(false)
  })
})
