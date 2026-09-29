import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { shellKind, buildIntegration, pwshEncodedHook, PWSH_INIT } from '@main/services/shellIntegration'

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

  it('pwsh: keeps base args, then -NoExit -EncodedCommand <hook>', () => {
    const out = buildIntegration('/usr/bin/pwsh', ['-NoLogo'], '/int', {})
    expect(out?.args).toEqual(['-NoLogo', '-NoExit', '-EncodedCommand', pwshEncodedHook()])
    expect(out?.env).toEqual({})
  })

  it('pwsh: never lowers the execution policy for the session', () => {
    for (const dir of ['/int', "C:\\Users\\O'Brien\\AppData"]) {
      const args = buildIntegration('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [], dir, {})!.args
      const joined = args.join(' ').toLowerCase()
      expect(joined).not.toContain('executionpolicy')
      expect(joined).not.toContain('bypass')
    }
  })

  it('pwsh: dot-sources no script file, the hook travels inline', () => {
    const args = buildIntegration('/usr/bin/pwsh', [], '/some/dir', {})!.args
    expect(args.join(' ')).not.toContain('.ps1')
    expect(args.join(' ')).not.toContain('/some/dir')
    expect(args).not.toContain('-Command')
    expect(args).not.toContain('-File')
  })

  it('pwsh: the encoded command decodes back to the hook (UTF-16LE base64)', () => {
    const decoded = Buffer.from(pwshEncodedHook(), 'base64').toString('utf16le')
    expect(decoded).toBe(PWSH_INIT)
    expect(decoded).toContain('function global:prompt')
  })

  it('returns null for unsupported shells', () => {
    expect(buildIntegration('/bin/fish', ['-l'], '/int', {})).toBeNull()
    expect(buildIntegration('C:\\Windows\\System32\\cmd.exe', [], '/int', {})).toBeNull()
  })
})
