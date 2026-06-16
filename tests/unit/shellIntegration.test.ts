import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { shellKind, buildIntegration } from '@main/services/shellIntegration'

describe('shellKind', () => {
  it('classifies shells by basename, ignoring path and .exe', () => {
    expect(shellKind('/bin/zsh')).toBe('zsh')
    expect(shellKind('/usr/bin/bash')).toBe('bash')
    expect(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellKind('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('pwsh')
    expect(shellKind('/bin/fish')).toBe('other')
    expect(shellKind('C:\\Windows\\System32\\cmd.exe')).toBe('other')
  })
})

describe('buildIntegration', () => {
  it('zsh: overrides ZDOTDIR and remembers the user dir, keeps base args', () => {
    const out = buildIntegration('/bin/zsh', ['-l'], '/int', { ZDOTDIR: '/home/me/zdot' })
    expect(out).toEqual({
      args: ['-l'],
      env: { ZDOTDIR: '/int', DOCKTERM_USER_ZDOTDIR: '/home/me/zdot' }
    })
  })

  it('zsh: falls back to HOME when ZDOTDIR is unset', () => {
    const out = buildIntegration('/bin/zsh', ['-l'], '/int', { HOME: '/home/me' })
    expect(out?.env.DOCKTERM_USER_ZDOTDIR).toBe('/home/me')
  })

  it('bash: uses --rcfile + interactive', () => {
    const out = buildIntegration('/bin/bash', ['-l'], '/int', {})
    expect(out?.args).toEqual(['--rcfile', join('/int', 'bash-integration.bash'), '-i'])
  })

  it('pwsh: appends -NoExit -Command to dot-source the script', () => {
    const out = buildIntegration('/usr/bin/pwsh', ['-NoLogo'], '/int', {})
    expect(out?.args[0]).toBe('-NoLogo')
    expect(out?.args).toContain('-NoExit')
    expect(out?.args[out.args.length - 1]).toContain('pwsh-integration.ps1')
  })

  it('returns null for unsupported shells', () => {
    expect(buildIntegration('/bin/fish', ['-l'], '/int', {})).toBeNull()
    expect(buildIntegration('C:\\Windows\\System32\\cmd.exe', [], '/int', {})).toBeNull()
  })
})
