import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { FILES, BASH_INIT, PWSH_INIT } from '@main/services/shellIntegration'

/** Runs the REAL zsh / bash against the generated shell integration with a fake
 * `claude` on PATH, to check what the `claude` hook actually executes. */
const posix = process.platform !== 'win32'
const d = posix ? describe : describe.skip

let root: string
let bin: string
let home: string
let zdot: string
let settings: string

beforeAll(() => {
  if (!posix) return
  root = mkdtempSync(join(tmpdir(), 'dockterm-hook-'))
  bin = join(root, 'bin dir')
  home = join(root, 'home')
  zdot = join(root, 'int')
  mkdirSync(bin)
  mkdirSync(home)
  mkdirSync(zdot)
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\nprintf 'REAL'; for a in "$@"; do printf ' [%s]' "$a"; done; echo\n`)
  chmodSync(join(bin, 'claude'), 0o755)
  for (const [n, c] of Object.entries(FILES)) writeFileSync(join(zdot, n), c)
  settings = join(root, 'dock term', 'claude-settings.json')
  mkdirSync(join(root, 'dock term'))
  writeFileSync(settings, '{}')
})
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

function runShell(kind: 'zsh' | 'bash', userRc: string, script: string, env: Record<string, string> = {}): string {
  writeFileSync(join(home, kind === 'zsh' ? '.zshrc' : '.bashrc'), userRc)
  const base = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    TERM: 'dumb',
    DOCKTERM_USAGE_SETTINGS: settings,
    ...env
  }
  const r =
    kind === 'zsh'
      ? spawnSync('zsh', ['-i'], { input: script + '\nexit\n', env: { ...base, ZDOTDIR: zdot, DOCKTERM_USER_ZDOTDIR: home }, encoding: 'utf8' })
      : spawnSync('bash', ['--rcfile', join(zdot, 'bash-integration.bash'), '-i'], { input: script + '\nexit\n', env: base, encoding: 'utf8' })
  // eslint-disable-next-line no-control-regex
  return r.stdout.replace(/\x1b\][^\x07]*\x07/g, '').split('\n').filter((l) => l.startsWith('REAL') || l.startsWith('OUT:')).join('\n')
}

for (const kind of ['zsh', 'bash'] as const) {
  d(`${kind} claude hook`, () => {
    it('adds --settings <file> before the user args (path with a space)', () => {
      expect(runShell(kind, '', 'claude --resume "two words"')).toBe(`REAL [--settings] [${settings}] [--resume] [two words]`)
    })
    it('adds it for a bare claude and for subcommands', () => {
      expect(runShell(kind, '', 'claude')).toBe(`REAL [--settings] [${settings}]`)
      expect(runShell(kind, '', 'claude mcp list')).toBe(`REAL [--settings] [${settings}] [mcp] [list]`)
    })
    it('leaves the call alone when the user passes --settings (either form)', () => {
      expect(runShell(kind, '', 'claude --settings /x.json')).toBe('REAL [--settings] [/x.json]')
      expect(runShell(kind, '', 'claude --settings=/x.json -p hi')).toBe('REAL [--settings=/x.json] [-p] [hi]')
    })
    it('is inert when DockTerm does not export the settings path', () => {
      expect(runShell(kind, '', 'claude a', { DOCKTERM_USAGE_SETTINGS: '' })).toBe('REAL [a]')
    })
    it('calls the plain binary when the settings file is gone', () => {
      expect(runShell(kind, '', 'claude a', { DOCKTERM_USAGE_SETTINGS: join(root, 'missing.json') })).toBe('REAL [a]')
    })
    it('`command claude` bypasses the hook', () => {
      expect(runShell(kind, '', 'command claude a')).toBe('REAL [a]')
    })
    it('keeps the flags of a user alias claude=...', () => {
      expect(runShell(kind, `alias claude='claude --dangerously-skip-permissions'`, 'claude go')).toBe(
        `REAL [--settings] [${settings}] [--dangerously-skip-permissions] [go]`
      )
    })
    it('never overrides a claude function the user already defines', () => {
      expect(runShell(kind, `claude() { echo "OUT:mine $*"; }`, 'claude a')).toBe('OUT:mine a')
    })
    it('defines claude as a shell function while active', () => {
      const out = runShell(kind, '', 'type claude | head -1 | sed "s/^/OUT:/"')
      expect(out).toMatch(/function/)
    })
  })
}

describe('hook text', () => {
  it('bash and pwsh hooks only act through DOCKTERM_USAGE_SETTINGS and never edit dotfiles', () => {
    for (const t of [BASH_INIT, PWSH_INIT, FILES['.zshrc']]) {
      expect(t).toContain('DOCKTERM_USAGE_SETTINGS')
      expect(t).not.toMatch(/>>\s*~?\/?.*\.(zshrc|bashrc|profile)/)
    }
  })
  it('pwsh hook resolves the real claude by command type (no self-recursion) and honours --settings', () => {
    expect(PWSH_INIT).toContain('-CommandType Application, ExternalScript')
    expect(PWSH_INIT).toContain('& $real.Source --settings $env:DOCKTERM_USAGE_SETTINGS @args')
    expect(PWSH_INIT).toContain("'--settings'")
    expect(PWSH_INIT).toContain("-CommandType Function")
  })
})
