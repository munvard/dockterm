import { chmodSync, existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Result } from '@shared/result'

interface Recorded {
  extraConfig: string[]
  userNetworkOp: boolean
  args: string[][]
}
const recorded: Recorded[] = []

// Wrap the real git() so each test can see which options a call ran with and
// which raw git arguments went through it. Everything still runs real git.
vi.mock('@main/services/gitCore', async (importOriginal) => {
  const real = await importOriginal<typeof import('@main/services/gitCore')>()
  return {
    ...real,
    git: (root: string, opts: { extraConfig?: string[]; userNetworkOp?: boolean } = {}) => {
      const rec: Recorded = {
        extraConfig: opts.extraConfig ?? [],
        userNetworkOp: !!opts.userNetworkOp,
        args: []
      }
      recorded.push(rec)
      const inner = real.git(root, opts)
      return new Proxy(inner, {
        get(target, prop, receiver) {
          const v = Reflect.get(target, prop, receiver)
          if (prop === 'raw' && typeof v === 'function') {
            return (...a: unknown[]) => {
              rec.args.push((Array.isArray(a[0]) ? a[0] : a).map(String))
              return (v as (...x: unknown[]) => unknown).apply(target, a)
            }
          }
          return typeof v === 'function' ? v.bind(target) : v
        }
      })
    }
  }
})

import {
  getStatus,
  branches,
  headHash,
  isReachable,
  changedSince,
  diffFile,
  push,
  pull
} from '@main/services/gitService'
import { getBranch } from '@main/services/projectService'
import {
  clearTrustedRepos,
  trustRepo,
  readOnlyHardening,
  scanExecConfig,
  detectExecConfig,
  displaySafe,
  assertGateOpen
} from '@main/services/gitTrust'
import { registerGitHandlers } from '@main/ipc/handlers/git'
import { setActiveRoot, clearActiveRoot } from '@main/services/activeRoot'

let dir: string
let sideDir: string
const run = (args: string[]): void => {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
}
const markerPath = (name: string): string => join(sideDir, name)

/** A script that appends to a marker file, then behaves like `cat` (or, for a
 * textconv / external diff, prints the file it was given). */
function makeScript(name: string, marker: string): string {
  const path = join(sideDir, name)
  writeFileSync(path, `#!/bin/sh\necho ran >> "${marker}"\nif [ -n "$1" ] && [ -f "$1" ]; then cat "$1"; else cat; fi\n`)
  chmodSync(path, 0o755)
  return path
}

/** Same size, different content, mtime moved forward: git's stat check no longer
 * matches, so `status` must re-hash the file through its clean filter. */
function touchSameSize(file: string, content: string): void {
  const p = join(dir, file)
  writeFileSync(p, content)
  const t = new Date(Date.now() + 10_000)
  utimesSync(p, t, t)
}

const EDITOR_VARS = ['GIT_EDITOR', 'EDITOR', 'VISUAL', 'PAGER', 'GIT_PAGER']

describe('displaySafe', () => {
  it('writes newlines, carriage returns and tabs as escapes', () => {
    expect(displaySafe('a\nb\r\nc\td')).toBe('a\\nb\\r\\nc\\td')
  })

  it('escapes ESC so an ANSI sequence shows as text instead of acting', () => {
    expect(displaySafe('\x1b[2J\x1b[8mhidden\x1b[0m')).toBe('\\x1b[2J\\x1b[8mhidden\\x1b[0m')
    expect(displaySafe('\x1b]0;title\x07')).toBe('\\x1b]0;title\\x07')
  })

  it('escapes other C0/C1 controls and DEL', () => {
    expect(displaySafe('a\x00b\x07c\x7fd\x9be')).toBe('a\\x00b\\x07c\\x7fd\\x9be')
  })

  it('escapes zero-width and bidi characters', () => {
    const bidi = 'safe\u202Etxt.exe\u202C'
    expect(displaySafe(bidi)).toBe('safe\\u202etxt.exe\\u202c')
    for (const c of ['\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u202A', '\u202D', '\u2066', '\u2069', '\uFEFF']) {
      expect(displaySafe(`a${c}b`), c.charCodeAt(0).toString(16)).toMatch(/^a\\u[0-9a-f]{4}b$/)
    }
  })

  it('truncates AFTER escaping, so nothing hides behind the cut', () => {
    const out = displaySafe('\n'.repeat(300))
    expect(out.startsWith('\\n'.repeat(100))).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('\n')
    expect(displaySafe('x'.repeat(500)).length).toBe(201)
  })

  it('is applied to both key and value in detectExecConfig', () => {
    const out = `local\0filter.a\u202Eb.clean\nevil\u200B\x1b[31m\0`
    const [e] = detectExecConfig(out)
    expect(e.key).toBe('filter.a\\u202eb.clean')
    expect(e.value).toBe('evil\\u200b\\x1b[31m')
    // ...while the raw scan keeps the true driver name for the overrides.
    expect(scanExecConfig(out)[0].key).toBe('filter.a\u202Eb.clean')
  })
})

describe('config scan is strict and fails closed', () => {
  const cfg = (rows: [string, string, string?][]): string =>
    rows.map(([k, v, scope]) => `${scope ?? 'local'}\0${k}\n${v}\0`).join('')

  it('rejects output that is not scope/key/value NUL records', () => {
    expect(() => scanExecConfig('local\0core.bare\nfalse')).toThrow() // no final NUL
    expect(() => scanExecConfig('local\0')).toThrow() // odd number of fields
    expect(() => scanExecConfig('\0core.bare\nfalse\0')).toThrow() // empty scope
    expect(() => scanExecConfig('local\0\nvalue\0')).toThrow() // empty key
  })

  it('accepts empty output', () => {
    expect(scanExecConfig('')).toEqual([])
  })

  it('reads the value after the FIRST newline and keeps later newlines', () => {
    const [e] = scanExecConfig(cfg([['core.editor', 'a\nb\nc']]))
    expect(e).toEqual({ key: 'core.editor', value: 'a\nb\nc' })
  })

  it('treats an unrecognized future scope as repo-controlled, and system/global/command/unknown as the user\'s', () => {
    expect(scanExecConfig(cfg([['filter.x.clean', 'c', 'future-scope']]))).toHaveLength(1)
    expect(scanExecConfig(cfg([['filter.x.clean', 'c', 'submodule']]))).toHaveLength(1)
    for (const scope of ['system', 'global', 'command', 'unknown']) {
      expect(scanExecConfig(cfg([['filter.x.clean', 'c', scope]])), scope).toEqual([])
    }
  })

  it('readOnlyHardening rejects when the config cannot be read (never "no dangerous keys")', async () => {
    clearTrustedRepos()
    await expect(readOnlyHardening('/x', async () => { throw new Error('fatal: bad config') })).rejects.toThrow('bad config')
    await expect(
      readOnlyHardening('/x', async () => { throw new Error('Use of "EDITOR" is not permitted without enabling allowUnsafeEditor') })
    ).rejects.toThrow('not permitted')
    await expect(readOnlyHardening('/x', async () => { throw new Error('block timeout') })).rejects.toThrow('timeout')
    await expect(readOnlyHardening('/x', async () => 'garbage')).rejects.toThrow()
  })

  it('readOnlyHardening is [] only for "not a repository" and for a trusted repo', async () => {
    clearTrustedRepos()
    expect(
      await readOnlyHardening('/x', async () => { throw new Error('fatal: not a git repository') })
    ).toEqual([])
    trustRepo('/x')
    expect(await readOnlyHardening('/x', async () => { throw new Error('boom') })).toEqual([])
    clearTrustedRepos()
  })

  it('assertGateOpen rejects on a read failure too', async () => {
    clearTrustedRepos()
    await expect(assertGateOpen('/x', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(assertGateOpen('/x', async () => cfg([['filter.x.clean', 'c']]))).rejects.toThrow('UNTRUSTED_GIT_CONFIG')
    await expect(assertGateOpen('/x', async () => cfg([['core.bare', 'false']]))).resolves.toBeUndefined()
  })
})

describe('hostile repo, through the real service', () => {
  const saved = EDITOR_VARS.map((k) => [k, process.env[k]] as const)

  beforeEach(() => {
    for (const k of EDITOR_VARS) delete process.env[k]
    clearTrustedRepos()
    recorded.length = 0
    dir = mkdtempSync(join(tmpdir(), 'dockterm-hard-'))
    sideDir = mkdtempSync(join(tmpdir(), 'dockterm-hard-side-'))
    run(['init', '-q'])
  })
  afterEach(() => {
    for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
    rmSync(dir, { recursive: true, force: true })
    rmSync(sideDir, { recursive: true, force: true })
  })

  /** Commit two files under two filter drivers, with the drivers disabled so the
   * index holds their stat entries. */
  function commitWithFilters(): void {
    const script = makeScript('filter.sh', markerPath('filter-marker'))
    run(['config', 'filter.probe.clean', script])
    run(['config', 'filter.probe.smudge', script])
    run(['config', 'filter.probe.required', 'true'])
    run(['config', 'filter.pp.process', script])
    writeFileSync(join(dir, '.gitattributes'), 'a.txt filter=probe\nb.txt filter=pp\n')
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    writeFileSync(join(dir, 'b.txt'), 'bee\n')
    execFileSync(
      'git',
      ['-c', 'filter.probe.clean=', '-c', 'filter.probe.smudge=', '-c', 'filter.pp.process=', '-c', 'filter.probe.required=false', 'add', '-A'],
      { cwd: dir, stdio: 'ignore' }
    )
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
    rmSync(markerPath('filter-marker'), { force: true })
  }

  describe('filter drivers (clean, smudge, process)', () => {
    it('control: plain git status runs the clean filter on a stat-changed file', () => {
      commitWithFilters()
      touchSameSize('a.txt', 'HELLO\n')
      execFileSync('git', ['status', '--porcelain'], { cwd: dir, stdio: 'ignore' })
      expect(existsSync(markerPath('filter-marker'))).toBe(true)
    })

    it('getStatus, changedSince, diffFile, headHash, branches never run a clean or process driver', async () => {
      commitWithFilters()
      touchSameSize('a.txt', 'HELLO\n')
      touchSameSize('b.txt', 'bed\n')
      expect((await getStatus(dir)).repoState).not.toBe('not-repo')
      await changedSince(dir, 'working', null, [])
      await diffFile(dir, 'working', null, 'a.txt')
      await headHash(dir)
      await branches(dir)
      expect(existsSync(markerPath('filter-marker'))).toBe(false)
    })

    it('a trusted repo keeps its filters', async () => {
      commitWithFilters()
      touchSameSize('a.txt', 'HELLO\n')
      trustRepo(dir)
      await getStatus(dir)
      expect(existsSync(markerPath('filter-marker'))).toBe(true)
    })

    it('neutralizes a driver whose name contains dots and one that differs only by case', async () => {
      const script = makeScript('f2.sh', markerPath('dot-marker'))
      run(['config', 'filter.a.b.clean', script])
      run(['config', 'filter.Up.clean', script])
      run(['config', 'filter.up.clean', script])
      writeFileSync(join(dir, '.gitattributes'), 'a.txt filter=a.b\nb.txt filter=Up\nc.txt filter=up\n')
      for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(dir, f), 'one\n')
      execFileSync('git', ['-c', 'filter.a.b.clean=', '-c', 'filter.Up.clean=', '-c', 'filter.up.clean=', 'add', '-A'], { cwd: dir, stdio: 'ignore' })
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'i'], { cwd: dir, stdio: 'ignore' })
      rmSync(markerPath('dot-marker'), { force: true })
      for (const f of ['a.txt', 'b.txt', 'c.txt']) touchSameSize(f, 'two\n')

      execFileSync('git', ['status', '--porcelain'], { cwd: dir, stdio: 'ignore' })
      expect(existsSync(markerPath('dot-marker'))).toBe(true) // control
      rmSync(markerPath('dot-marker'), { force: true })
      for (const f of ['a.txt', 'b.txt', 'c.txt']) touchSameSize(f, 'tri\n')

      await getStatus(dir)
      expect(existsSync(markerPath('dot-marker'))).toBe(false)
      const overrides = await readOnlyHardening(dir)
      expect(overrides).toContain('filter.a.b.clean=')
      expect(overrides).toContain('filter.Up.clean=')
      expect(overrides).toContain('filter.up.clean=')
    })

    it('finds a driver defined through include.path', async () => {
      const script = makeScript('f3.sh', markerPath('inc-marker'))
      writeFileSync(join(dir, '.git', 'extra.cfg'), `[filter "inc"]\n\tclean = ${script}\n`)
      run(['config', 'include.path', 'extra.cfg'])
      expect(await readOnlyHardening(dir)).toContain('filter.inc.clean=')
    })
  })

  describe('diff drivers (textconv, external diff) and fsmonitor', () => {
    function commitWithDiffDrivers(): void {
      writeFileSync(join(dir, '.gitattributes'), '*.txt diff=probe\n')
      writeFileSync(join(dir, 'a.txt'), 'one\n')
      run(['add', '-A'])
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'i'], { cwd: dir, stdio: 'ignore' })
      run(['config', 'diff.probe.textconv', makeScript('tc.sh', markerPath('diff-marker'))])
      run(['config', 'diff.probe.command', makeScript('xd.sh', markerPath('diff-marker'))])
      writeFileSync(join(dir, 'a.txt'), 'two\n')
    }

    it('control: a plain git diff runs both the textconv and the external diff driver', () => {
      commitWithDiffDrivers()
      execFileSync('git', ['diff'], { cwd: dir, stdio: 'ignore' })
      expect(existsSync(markerPath('diff-marker'))).toBe(true)
    })

    it('an EMPTY diff.<x>.textconv / command is not a disable (git tries to run "" and dies), so flags are used', () => {
      commitWithDiffDrivers()
      expect(() =>
        execFileSync('git', ['-c', 'diff.probe.textconv=', '-c', 'diff.probe.command=', 'diff'], { cwd: dir, stdio: 'pipe' })
      ).toThrow()
      expect(() =>
        execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv'], { cwd: dir, stdio: 'pipe' })
      ).not.toThrow()
    })

    it('changedSince and diffFile run no diff driver, and every diff carries --no-ext-diff --no-textconv', async () => {
      commitWithDiffDrivers()
      await changedSince(dir, 'working', null, [])
      await diffFile(dir, 'working', null, 'a.txt')
      expect(existsSync(markerPath('diff-marker'))).toBe(false)
      const diffs = recorded.flatMap((r) => r.args).filter((a) => a[0] === 'diff')
      expect(diffs.length).toBeGreaterThan(0)
      for (const d of diffs) {
        expect(d, d.join(' ')).toContain('--no-ext-diff')
        expect(d, d.join(' ')).toContain('--no-textconv')
      }
    })

    it('a repo-local core.fsmonitor hook is not run by status (control: plain git runs it)', async () => {
      writeFileSync(join(dir, 'a.txt'), 'one\n')
      run(['add', '-A'])
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'i'], { cwd: dir, stdio: 'ignore' })
      const hook = join(sideDir, 'fsm.sh')
      writeFileSync(hook, `#!/bin/sh\necho ran >> "${markerPath('fsm-marker')}"\nprintf '\\0'\n`)
      chmodSync(hook, 0o755)
      run(['config', 'core.fsmonitor', hook])
      execFileSync('git', ['status', '--porcelain'], { cwd: dir, stdio: 'ignore' })
      expect(existsSync(markerPath('fsm-marker'))).toBe(true)
      rmSync(markerPath('fsm-marker'), { force: true })
      await getStatus(dir)
      await changedSince(dir, 'working', null, [])
      expect(existsSync(markerPath('fsm-marker'))).toBe(false)
    })
  })

  describe('coverage: every automatic call is neutralized on an untrusted hostile repo', () => {
    it('gives every automatic git handle the filter overrides, and never a network pass-through', async () => {
      commitWithFilters()
      recorded.length = 0
      await getStatus(dir)
      await branches(dir)
      await headHash(dir)
      await isReachable(dir, 'HEAD')
      await changedSince(dir, 'working', null, [])
      await changedSince(dir, 'checkpoint', 'HEAD', [])
      await diffFile(dir, 'working', null, 'a.txt')
      await getBranch(dir)
      expect(recorded.length).toBeGreaterThan(0)
      const isConfigRead = (r: Recorded): boolean => r.args.some((a) => a[0] === 'config')
      const automatic = recorded.filter((r) => !isConfigRead(r))
      expect(automatic.length).toBeGreaterThanOrEqual(8)
      for (const r of automatic) {
        expect(r.extraConfig).toContain('filter.probe.clean=')
        expect(r.extraConfig).toContain('filter.pp.process=')
        expect(r.userNetworkOp).toBe(false)
      }
    })
  })

  describe('network path', () => {
    it('push and pull refuse an untrusted hostile repo before any git handle carries the user\'s ssh/askpass', async () => {
      run(['config', 'core.sshCommand', 'echo pwned'])
      run(['config', 'credential.helper', '!echo pwned'])
      recorded.length = 0
      await expect(push(dir, {})).rejects.toThrow('UNTRUSTED_GIT_CONFIG')
      await expect(pull(dir)).rejects.toThrow('UNTRUSTED_GIT_CONFIG')
      expect(recorded.some((r) => r.userNetworkOp)).toBe(false)
    })

    it('after the user trusts the repo, only push and pull carry the pass-through', async () => {
      run(['config', 'core.sshCommand', 'echo x'])
      trustRepo(dir)
      recorded.length = 0
      await push(dir, {}).catch(() => undefined)
      await pull(dir).catch(() => undefined)
      const net = recorded.filter((r) => r.userNetworkOp)
      expect(net.length).toBe(2)
      recorded.length = 0
      await getStatus(dir)
      await branches(dir)
      expect(recorded.some((r) => r.userNetworkOp)).toBe(false)
    })

    it('the handler still returns UNTRUSTED_GIT_CONFIG with display-safe entries', async () => {
      const WIN = 5151
      const event = { sender: { id: WIN } } as unknown as IpcMainInvokeEvent
      const handlers = new Map<string, (req: unknown, e: IpcMainInvokeEvent) => Promise<Result<unknown>> | Result<unknown>>()
      registerGitHandlers(((channel: string, _s: unknown, h: never) => {
        handlers.set(channel, h)
      }) as never)
      run(['config', 'core.editor', 'evil\u202Ecmd\x1b[2J\nsecond'])
      setActiveRoot(WIN, dir)
      try {
        const res = await handlers.get('git:stage')!({ paths: ['x'] }, event)
        expect(res.ok).toBe(false)
        if (res.ok) return
        expect(res.error.code).toBe('UNTRUSTED_GIT_CONFIG')
        const d = res.error.details as { entries: { key: string; value: string }[] }
        expect(d.entries[0].value).toBe('evil\\u202ecmd\\x1b[2J\\nsecond')
      } finally {
        clearActiveRoot(WIN)
      }
    })
  })

  describe('a broken config is not "not a repo"', () => {
    it('getStatus rejects (no not-repo view) when the repo config cannot be read', async () => {
      writeFileSync(join(dir, '.git', 'config'), '[core\n\tbare = false\n')
      await expect(getStatus(dir)).rejects.toThrow()
      await expect(getStatus(dir)).rejects.not.toThrow(/not a git repository/i)
    })
  })
})
