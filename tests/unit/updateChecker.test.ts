import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// runningAppImage probes the filesystem; control existsSync per test. The other
// node:fs / node:fs.promises members are only touched at call time, not import time.
const existing = new Set<string>()
vi.mock('node:fs', () => ({
  existsSync: (p: string) => existing.has(p),
  createWriteStream: vi.fn()
}))

import {
  isNewer,
  runningAppImage,
  linuxRelaunchArgs,
  parseUpdateYmlShaByUrl,
  pickAsset,
  isValidSha512,
  updateInfoAssetName,
  parseUpdateYmlVersion,
  resolveExpectedSha512,
  safeReleaseUrl,
  type GhAsset
} from '@main/services/updateChecker'

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

describe('parseUpdateYmlShaByUrl', () => {
  it('parses a multi-file latest-mac.yml (both mac arches merged)', () => {
    const yml = `version: 0.29.4
files:
  - url: DockTerm-0.29.4-mac-arm64.dmg
    sha512: aaaaAAAA1111====
    size: 123456
  - url: DockTerm-0.29.4-mac-x64.dmg
    sha512: bbbbBBBB2222====
    size: 654321
path: DockTerm-0.29.4-mac-arm64.dmg
sha512: aaaaAAAA1111====
releaseDate: '2026-09-28T12:00:00.000Z'
`
    const map = parseUpdateYmlShaByUrl(yml)
    expect(map.get('DockTerm-0.29.4-mac-arm64.dmg')).toBe('aaaaAAAA1111====')
    expect(map.get('DockTerm-0.29.4-mac-x64.dmg')).toBe('bbbbBBBB2222====')
  })

  it('parses a single-file latest.yml (Windows)', () => {
    const yml = `version: 0.29.4
files:
  - url: DockTerm-0.29.4-windows-x64.exe
    sha512: ccccCCCC3333====
    size: 999
path: DockTerm-0.29.4-windows-x64.exe
sha512: ccccCCCC3333====
releaseDate: '2026-09-28T12:00:00.000Z'
`
    expect(parseUpdateYmlShaByUrl(yml).get('DockTerm-0.29.4-windows-x64.exe')).toBe('ccccCCCC3333====')
  })

  it('returns an empty map for content with no files: list or top-level pair', () => {
    expect(parseUpdateYmlShaByUrl('not: yaml\njust some text\n').size).toBe(0)
  })
})

describe('pickAsset (URL pinning + platform/arch matching)', () => {
  const origPlatform = process.platform
  const origArch = process.arch
  const setPlatform = (p: string): void => {
    Object.defineProperty(process, 'platform', { value: p, configurable: true })
  }
  const setArch = (a: string): void => {
    Object.defineProperty(process, 'arch', { value: a, configurable: true })
  }
  afterEach(() => {
    setPlatform(origPlatform)
    setArch(origArch)
  })

  it('refuses an asset hosted off the pinned GitHub releases path', () => {
    setPlatform('linux')
    const assets: GhAsset[] = [
      {
        name: 'DockTerm-Linux.AppImage',
        browser_download_url: 'https://evil.example.com/DockTerm-Linux.AppImage'
      }
    ]
    expect(pickAsset(assets)).toBeNull()
  })

  it('accepts an asset hosted under the pinned GitHub releases path', () => {
    setPlatform('linux')
    const url = 'https://github.com/munvard/dockterm/releases/download/v0.29.4/DockTerm-Linux.AppImage'
    const assets: GhAsset[] = [{ name: 'DockTerm-Linux.AppImage', browser_download_url: url }]
    expect(pickAsset(assets)).toEqual({ url, name: 'DockTerm-Linux.AppImage' })
  })

  it('matches the right mac arch asset and ignores the other', () => {
    setPlatform('darwin')
    setArch('arm64')
    const base = 'https://github.com/munvard/dockterm/releases/download/v0.29.4/'
    const assets: GhAsset[] = [
      {
        name: 'DockTerm-0.29.4-macOS-Intel.dmg',
        browser_download_url: base + 'DockTerm-0.29.4-macOS-Intel.dmg'
      },
      {
        name: 'DockTerm-0.29.4-macOS-Apple-Silicon.dmg',
        browser_download_url: base + 'DockTerm-0.29.4-macOS-Apple-Silicon.dmg'
      }
    ]
    expect(pickAsset(assets)?.name).toBe('DockTerm-0.29.4-macOS-Apple-Silicon.dmg')
  })
})

describe('update checksum fail-closed (Codex 7)', () => {
  const SHA_A = 'A'.repeat(86) + '=='
  const SHA_B = 'B'.repeat(86) + '=='
  const yml = (version: string, files: Array<[string, string]>): string =>
    [
      `version: ${version}`,
      'files:',
      ...files.flatMap(([u, s]) => [`  - url: ${u}`, `    sha512: ${s}`, '    size: 10']),
      `path: ${files[0][0]}`,
      `sha512: ${files[0][1]}`,
      "releaseDate: '2026-09-29T00:00:00.000Z'",
      ''
    ].join('\n')

  it('isValidSha512 accepts only base64 of 64 bytes', () => {
    expect(isValidSha512(SHA_A)).toBe(true)
    expect(isValidSha512('')).toBe(false)
    expect(isValidSha512(null)).toBe(false)
    expect(isValidSha512(undefined)).toBe(false)
    expect(isValidSha512('abc')).toBe(false)
    expect(isValidSha512('A'.repeat(86))).toBe(false)
    expect(isValidSha512('!'.repeat(86) + '==')).toBe(false)
  })

  it('names the checksum asset per platform and, on macOS, per arch', () => {
    expect(updateInfoAssetName('win32', 'x64')).toBe('latest.yml')
    expect(updateInfoAssetName('linux', 'x64')).toBe('latest-linux.yml')
    expect(updateInfoAssetName('darwin', 'arm64')).toBe('latest-mac-arm64.yml')
    expect(updateInfoAssetName('darwin', 'x64')).toBe('latest-mac-x64.yml')
    expect(updateInfoAssetName('freebsd', 'x64')).toBeNull()
  })

  it('reads the manifest version', () => {
    expect(parseUpdateYmlVersion(yml('0.31.0', [['a-mac-arm64.dmg', SHA_A]]))).toBe('0.31.0')
    expect(parseUpdateYmlVersion("version: '0.31.0'\n")).toBe('0.31.0')
    expect(parseUpdateYmlVersion('files:\n')).toBeNull()
  })

  it('selects the checksum of this arch from a per-arch manifest', () => {
    const y = yml('0.31.0', [['DockTerm-0.31.0-mac-arm64.dmg', SHA_A]])
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'arm64', version: '0.31.0' })).toBe(SHA_A)
  })

  it('selects by arch when a manifest lists both mac arches', () => {
    const y = yml('0.31.0', [
      ['DockTerm-0.31.0-mac-arm64.dmg', SHA_A],
      ['DockTerm-0.31.0-mac-x64.dmg', SHA_B]
    ])
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'x64', version: '0.31.0' })).toBe(SHA_B)
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'arm64', version: '0.31.0' })).toBe(SHA_A)
  })

  it('returns null (fail closed) for the wrong arch, wrong version, or no match', () => {
    const y = yml('0.31.0', [['DockTerm-0.31.0-mac-arm64.dmg', SHA_A]])
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'x64', version: '0.31.0' })).toBeNull()
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'arm64', version: '0.32.0' })).toBeNull()
    expect(resolveExpectedSha512(y, { platform: 'win32', arch: 'x64', version: '0.31.0' })).toBeNull()
    expect(resolveExpectedSha512('', { platform: 'win32', arch: 'x64', version: '0.31.0' })).toBeNull()
  })

  it('returns null for a malformed or empty checksum', () => {
    for (const bad of ['', 'not-a-hash', 'A'.repeat(86)]) {
      const y = yml('0.31.0', [['DockTerm-0.31.0-windows-x64.exe', bad]])
      expect(resolveExpectedSha512(y, { platform: 'win32', arch: 'x64', version: '0.31.0' })).toBeNull()
    }
  })

  it('returns null when two matching files disagree', () => {
    const y = yml('0.31.0', [
      ['DockTerm-0.31.0-mac-arm64.dmg', SHA_A],
      ['Other-0.31.0-mac-arm64.dmg', SHA_B]
    ])
    expect(resolveExpectedSha512(y, { platform: 'darwin', arch: 'arm64', version: '0.31.0' })).toBeNull()
  })

  it('only opens release pages of this repository', () => {
    expect(safeReleaseUrl('https://github.com/munvard/dockterm/releases/tag/v1')).toContain('github.com/')
    expect(safeReleaseUrl('https://evil.example/x')).toBe(safeReleaseUrl(undefined))
    expect(safeReleaseUrl('file:///etc/passwd')).toBe(safeReleaseUrl(undefined))
  })
})
