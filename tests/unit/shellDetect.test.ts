import { describe, it, expect } from 'vitest'
import { detectShell } from '@main/services/shellDetect'

describe('detectShell', () => {
  it('uses $SHELL as a login shell on macOS', () => {
    const spec = detectShell({ platform: 'darwin', env: { SHELL: '/bin/zsh' }, exists: () => false })
    expect(spec.file).toBe('/bin/zsh')
    expect(spec.args).toContain('-l')
  })

  it('defaults to /bin/zsh on macOS when SHELL is unset', () => {
    const spec = detectShell({ platform: 'darwin', env: {}, exists: () => false })
    expect(spec.file).toBe('/bin/zsh')
  })

  it('defaults to /bin/bash on linux when SHELL is unset', () => {
    const spec = detectShell({ platform: 'linux', env: {}, exists: () => false })
    expect(spec.file).toBe('/bin/bash')
  })

  it('prefers pwsh.exe on Windows when present on PATH', () => {
    const spec = detectShell({
      platform: 'win32',
      env: { PATH: 'C:\\tools;C:\\other', SystemRoot: 'C:\\Windows' },
      exists: (p) => p.toLowerCase().endsWith('pwsh.exe')
    })
    expect(spec.file.toLowerCase()).toContain('pwsh.exe')
    expect(spec.args).toContain('-NoLogo')
  })

  it('falls back to Windows PowerShell when pwsh is absent', () => {
    const spec = detectShell({
      platform: 'win32',
      env: { PATH: 'C:\\tools', SystemRoot: 'C:\\Windows' },
      exists: (p) => p.toLowerCase().includes('windowspowershell')
    })
    expect(spec.file.toLowerCase()).toContain('powershell.exe')
  })

  it('falls back to COMSPEC when no PowerShell exists', () => {
    const spec = detectShell({
      platform: 'win32',
      env: { PATH: 'C:\\tools', SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' },
      exists: () => false
    })
    expect(spec.file.toLowerCase()).toContain('cmd.exe')
  })
})
