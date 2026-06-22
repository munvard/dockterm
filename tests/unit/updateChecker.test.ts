import { describe, it, expect, vi, beforeEach } from 'vitest'

// runningAppImage probes the filesystem; control existsSync per test. The other
// node:fs / node:fs.promises members are only touched at call time, not import time.
const existing = new Set<string>()
vi.mock('node:fs', () => ({
  existsSync: (p: string) => existing.has(p),
  createWriteStream: vi.fn()
}))

import { isNewer, runningAppImage, linuxRelaunchArgs } from '@main/services/updateChecker'

describe('isNewer (update version compare)', () => {
  it('detects a higher version', () => {
    expect(isNewer('0.22.0', '0.21.0')).toBe(true)
    expect(isNewer('1.0.0', '0.21.0')).toBe(true)
    expect(isNewer('0.21.1', '0.21.0')).toBe(true)
    expect(isNewer('0.21.10', '0.21.9')).toBe(true)
  })
  it('rejects same or older', () => {
    expect(isNewer('0.21.0', '0.21.0')).toBe(false)
    expect(isNewer('0.20.5', '0.21.0')).toBe(false)
    expect(isNewer('0.9.9', '0.21.0')).toBe(false)
  })
  it('tolerates a leading v', () => {
    expect(isNewer('v0.22.0', '0.21.0')).toBe(true)
    expect(isNewer('v0.21.0', 'v0.21.0')).toBe(false)
  })
})

describe('runningAppImage (Linux self-update gate)', () => {
  beforeEach(() => existing.clear())

  it('returns the path when $APPIMAGE is a real, existing .AppImage', () => {
    const p = '/home/u/Apps/DockTerm-0.26.0-linux-x86_64.AppImage'
    existing.add(p)
    expect(runningAppImage({ APPIMAGE: p } as NodeJS.ProcessEnv)).toBe(p)
  })

  it('is case-insensitive on the extension', () => {
    const p = '/home/u/DockTerm.appimage'
    existing.add(p)
    expect(runningAppImage({ APPIMAGE: p } as NodeJS.ProcessEnv)).toBe(p)
  })

  it('returns null when $APPIMAGE is unset (dev run)', () => {
    expect(runningAppImage({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('returns null for the extracted-AppDir AppRun fallback (not a .AppImage)', () => {
    const p = '/tmp/.mount_DockXX/AppRun'
    existing.add(p)
    expect(runningAppImage({ APPIMAGE: p } as NodeJS.ProcessEnv)).toBeNull()
  })

  it('returns null when the path no longer exists on disk', () => {
    expect(
      runningAppImage({ APPIMAGE: '/gone/DockTerm.AppImage' } as NodeJS.ProcessEnv)
    ).toBeNull()
  })
})

describe('linuxRelaunchArgs', () => {
  it('forces extract-and-run so the new build boots without libfuse2', () => {
    expect(linuxRelaunchArgs()).toEqual(['--appimage-extract-and-run'])
  })
})
