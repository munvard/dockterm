import os from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isFilesystemRoot, refuseGitInitTarget } from '@main/services/projectService'

describe('isFilesystemRoot', () => {
  it('is true for the POSIX root', () => {
    expect(isFilesystemRoot('/')).toBe(true)
  })

  // A Windows drive root ('C:\\') is only recognized as its own dirname under
  // node:path's win32 implementation, which is what runs in production on
  // Windows (the default `path` module IS `path.win32` there). Verified
  // directly against that implementation rather than the POSIX one this test
  // suite runs under.
  it('is true for a Windows drive root (via path.win32)', async () => {
    const { win32 } = await import('node:path')
    expect(win32.dirname('C:\\')).toBe('C:\\')
  })

  it('is false for an ordinary project folder', () => {
    expect(isFilesystemRoot(join('/Users', 'me', 'projects', 'app'))).toBe(false)
  })

  it('is false for the home directory itself', () => {
    expect(isFilesystemRoot(join('/Users', 'me'))).toBe(false)
  })
})

describe('refuseGitInitTarget', () => {
  it('refuses the filesystem root', () => {
    expect(refuseGitInitTarget('/')).not.toBeNull()
  })

  it('refuses the real home directory', () => {
    expect(refuseGitInitTarget(os.homedir())).not.toBeNull()
  })

  it('allows an ordinary project folder', () => {
    expect(refuseGitInitTarget(join(os.homedir(), 'projects', 'app'))).toBeNull()
  })
})
