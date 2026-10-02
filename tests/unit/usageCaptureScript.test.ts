import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { toRealUsage } from '@main/services/usageCaptureCore'

const SCRIPT = join(__dirname, '../../src/main/services/usageCapture/usage-capture.cjs')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cap = createRequire(import.meta.url)(SCRIPT) as {
  extract: (text: string, nowMs: number) => Record<string, any> | null
  merge: (prev: any, cur: any, nowMs: number) => any
  pickWindow: (a: any, b: any) => any
  resolveDelegate: (projectDir: string | null, configDir: string, read: (f: string) => any) => string | null
  delegateInvocation: (cmd: string, platform: string, env: Record<string, string>, exists: (p: string) => boolean) => { file: string; args: string[] }
}

const NOW = 1_790_000_000_000
const SEC = NOW / 1000

// Shaped like the JSON Claude Code 2.1.287 sends to a status line.
const payload = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    session_id: 'abc',
    cwd: '/Users/me/proj',
    model: { id: 'claude-haiku-4-5', display_name: 'Haiku 4.5' },
    workspace: { current_dir: '/Users/me/proj', project_dir: '/Users/me/proj' },
    cost: { total_cost_usd: 0.0123 },
    context_window: { used_percentage: 29, context_window_size: 200000 },
    rate_limits: {
      five_hour: { used_percentage: 7, resets_at: SEC + 3600 },
      seven_day: { used_percentage: 28, resets_at: SEC + 86400 }
    },
    ...over
  })

describe('extract', () => {
  it('reads rate limits, context, model, cost and project dir', () => {
    expect(cap.extract(payload(), NOW)).toEqual({
      sessionId: 'abc',
      fiveHour: { pct: 7, resetsAt: SEC + 3600 },
      sevenDay: { pct: 28, resetsAt: SEC + 86400 },
      contextPct: 29,
      contextSize: 200000,
      model: { id: 'claude-haiku-4-5', name: 'Haiku 4.5' },
      costUsd: 0.0123,
      projectDir: '/Users/me/proj'
    })
  })
  it('a window that is absent (no Pro/Max, or before the first response) stays null', () => {
    const e = cap.extract(payload({ rate_limits: undefined }), NOW)!
    expect(e.fiveHour).toBeNull()
    expect(e.sevenDay).toBeNull()
    const one = cap.extract(payload({ rate_limits: { five_hour: { used_percentage: 3, resets_at: SEC + 10 } } }), NOW)!
    expect(one.fiveHour).toEqual({ pct: 3, resetsAt: SEC + 10 })
    expect(one.sevenDay).toBeNull()
  })
  it('drops a window whose resets_at has passed', () => {
    const e = cap.extract(payload({ rate_limits: { five_hour: { used_percentage: 99, resets_at: SEC - 5 } } }), NOW)!
    expect(e.fiveHour).toBeNull()
  })
  it('accepts a resets_at in milliseconds too', () => {
    const e = cap.extract(payload({ rate_limits: { five_hour: { used_percentage: 1, resets_at: NOW + 60_000 } } }), NOW)!
    expect(e.fiveHour).toEqual({ pct: 1, resetsAt: Math.floor((NOW + 60_000) / 1000) })
  })
  it('keeps fractional percentages', () => {
    const e = cap.extract(payload({ rate_limits: { five_hour: { used_percentage: 23.5, resets_at: SEC + 5 } } }), NOW)!
    expect(e.fiveHour.pct).toBe(23.5)
  })
  it('garbage input gives null, never a throw', () => {
    for (const bad of ['', 'not json', '[]', 'null', '5', '{"rate_limits":']) expect(cap.extract(bad, NOW)).toBeNull()
  })
  it('wrong-typed fields become null', () => {
    const e = cap.extract(payload({ rate_limits: { five_hour: { used_percentage: 'x', resets_at: SEC + 5 } }, cost: { total_cost_usd: 'a' }, context_window: 3, model: 'x' }), NOW)!
    expect(e.fiveHour).toBeNull()
    expect(e.costUsd).toBeNull()
    expect(e.contextPct).toBeNull()
    expect(e.model).toBeNull()
  })
})

describe('merge / pickWindow', () => {
  const cur = (o: Record<string, unknown> = {}): any => ({ ...cap.extract(payload(), NOW)!, ...o })
  it('a first capture becomes the record', () => {
    const r = cap.merge(null, cur(), NOW)
    expect(r).toMatchObject({ v: 1, updatedAt: NOW, limitsAt: NOW, fiveHour: { pct: 7 }, sevenDay: { pct: 28 }, model: { name: 'Haiku 4.5' } })
  })
  it('the newer window (later reset) wins even with a lower percentage', () => {
    const prev = cap.merge(null, cur({ fiveHour: { pct: 90, resetsAt: SEC + 100 } }), NOW)
    const r = cap.merge(prev, cur({ fiveHour: { pct: 2, resetsAt: SEC + 18000 } }), NOW + 1)
    expect(r.fiveHour).toEqual({ pct: 2, resetsAt: SEC + 18000 })
  })
  it('an idle session re-sending an older window cannot roll usage back', () => {
    const prev = cap.merge(null, cur({ fiveHour: { pct: 10, resetsAt: SEC + 18000 } }), NOW)
    const r = cap.merge(prev, cur({ fiveHour: { pct: 3, resetsAt: SEC + 100 } }), NOW + 1)
    expect(r.fiveHour).toEqual({ pct: 10, resetsAt: SEC + 18000 })
  })
  it('within the same window the higher percentage wins', () => {
    expect(cap.pickWindow({ pct: 5, resetsAt: 9 }, { pct: 8, resetsAt: 9 })).toEqual({ pct: 8, resetsAt: 9 })
    expect(cap.pickWindow({ pct: 8, resetsAt: 9 }, { pct: 5, resetsAt: 9 })).toEqual({ pct: 8, resetsAt: 9 })
  })
  it('a capture without limits keeps the old windows and the old limitsAt', () => {
    const prev = cap.merge(null, cur(), NOW)
    const r = cap.merge(prev, cur({ fiveHour: null, sevenDay: null }), NOW + 5000)
    expect(r.fiveHour).toEqual(prev.fiveHour)
    expect(r.limitsAt).toBe(NOW)
    expect(r.updatedAt).toBe(NOW + 5000)
  })
  it('a previous window that has expired is dropped', () => {
    const prev = cap.merge(null, cur({ fiveHour: { pct: 50, resetsAt: SEC + 10 } }), NOW)
    const r = cap.merge(prev, cur({ fiveHour: null, sevenDay: null }), NOW + 20_000)
    expect(r.fiveHour).toBeNull()
  })
  it('a record of another format is ignored', () => {
    expect(cap.merge({ v: 99, fiveHour: { pct: 99, resetsAt: SEC + 9 } }, cur({ fiveHour: null }), NOW).fiveHour).toBeNull()
  })
  it('what merge writes is read back by toRealUsage in the app', () => {
    const r = cap.merge(null, cur(), NOW)
    expect(toRealUsage(r, NOW)).toMatchObject({
      fiveHour: { pct: 7, resetsAt: (SEC + 3600) * 1000 },
      sevenDay: { pct: 28, resetsAt: (SEC + 86400) * 1000 },
      contextPct: 29,
      model: 'Haiku 4.5'
    })
  })
})

describe('resolveDelegate', () => {
  const sl = (command: string): any => ({ statusLine: { type: 'command', command } })
  const reader = (files: Record<string, any>) => (f: string) => files[f.replace(/\\/g, '/')] ?? null
  it('local project settings beat project settings beat user settings', () => {
    const read = reader({
      '/p/.claude/settings.local.json': sl('local'),
      '/p/.claude/settings.json': sl('proj'),
      '/c/settings.json': sl('user')
    })
    expect(cap.resolveDelegate('/p', '/c', read)).toBe('local')
    expect(cap.resolveDelegate('/p', '/c', reader({ '/p/.claude/settings.json': sl('proj'), '/c/settings.json': sl('user') }))).toBe('proj')
    expect(cap.resolveDelegate('/p', '/c', reader({ '/c/settings.json': sl('user') }))).toBe('user')
    expect(cap.resolveDelegate(null, '/c', reader({ '/c/settings.json': sl('user') }))).toBe('user')
  })
  it('null when nobody defines a status line', () => {
    expect(cap.resolveDelegate('/p', '/c', reader({}))).toBeNull()
  })
  it('a project that defines an unusable status line means none', () => {
    expect(cap.resolveDelegate('/p', '/c', reader({ '/p/.claude/settings.json': { statusLine: null }, '/c/settings.json': sl('user') }))).toBeNull()
  })
  it('never runs itself', () => {
    expect(cap.resolveDelegate(null, '/c', reader({ '/c/settings.json': sl('sh "/x/usage-capture/usage-capture.sh"') }))).toBeNull()
  })
})

describe('delegateInvocation', () => {
  it('posix runs the command with /bin/sh -c', () => {
    expect(cap.delegateInvocation('echo hi', 'darwin', {}, () => false)).toEqual({ file: '/bin/sh', args: ['-c', 'echo hi'] })
  })
  it('windows prefers Git Bash, then PowerShell', () => {
    const env = { ProgramFiles: 'C:\\Program Files' }
    const bash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(cap.delegateInvocation('x', 'win32', env, (p) => p === bash)).toEqual({ file: bash, args: ['-c', 'x'] })
    expect(cap.delegateInvocation('x', 'win32', env, () => false)).toEqual({
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', 'x']
    })
    expect(cap.delegateInvocation('x', 'win32', { CLAUDE_CODE_GIT_BASH_PATH: 'D:\\b.exe' }, (p) => p === 'D:\\b.exe').file).toBe('D:\\b.exe')
  })
})

describe.skipIf(process.platform === 'win32')('running the script (child process, fake stdin)', () => {
  function sandbox(userSettings: unknown): { dir: string; out: string; run: (stdin: string, env?: Record<string, string>) => { stdout: string; status: number | null } } {
    const dir = mkdtempSync(join(tmpdir(), 'dockterm-cap-'))
    const cfg = join(dir, 'cfg')
    mkdirSync(cfg)
    if (userSettings) writeFileSync(join(cfg, 'settings.json'), JSON.stringify(userSettings))
    const s = join(dir, 'usage capture')
    mkdirSync(s)
    copyFileSync(SCRIPT, join(s, 'usage-capture.cjs'))
    const out = join(s, 'claude-usage.json')
    return {
      dir,
      out,
      run: (stdin, env = {}) => {
        const r = spawnSync(process.execPath, [join(s, 'usage-capture.cjs')], {
          input: stdin,
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', CLAUDE_CONFIG_DIR: cfg, ...env }
        })
        return { stdout: r.stdout, status: r.status }
      }
    }
  }

  it('saves the capture file and passes the user status line output through unchanged', () => {
    const sb = sandbox({ statusLine: { type: 'command', command: `cat; printf '|%s' "$DOCKTERM_USAGE_CAPTURE"` } })
    try {
      const input = payload({ rate_limits: { five_hour: { used_percentage: 12, resets_at: Math.floor(Date.now() / 1000) + 3600 } } })
      const r = sb.run(input)
      expect(r.status).toBe(0)
      expect(r.stdout).toBe(input + '|1')
      const saved = JSON.parse(readFileSync(sb.out, 'utf8'))
      expect(saved.v).toBe(1)
      expect(saved.fiveHour.pct).toBe(12)
      expect(saved.sevenDay).toBeNull()
      expect(existsSync(sb.out + '.' + 1)).toBe(false)
    } finally {
      rmSync(sb.dir, { recursive: true, force: true })
    }
  })

  it('without a user status line prints nothing and still captures', () => {
    const sb = sandbox(null)
    try {
      const r = sb.run(payload({ rate_limits: { seven_day: { used_percentage: 40, resets_at: Math.floor(Date.now() / 1000) + 9000 } } }))
      expect(r.stdout).toBe('')
      expect(r.status).toBe(0)
      expect(JSON.parse(readFileSync(sb.out, 'utf8')).sevenDay.pct).toBe(40)
    } finally {
      rmSync(sb.dir, { recursive: true, force: true })
    }
  })

  it('garbage stdin: exit 0, no capture file, user status line still runs', () => {
    const sb = sandbox({ statusLine: { type: 'command', command: 'echo STILL-HERE' } })
    try {
      const r = sb.run('{{{ nope')
      expect(r.status).toBe(0)
      expect(r.stdout).toBe('STILL-HERE\n')
      expect(existsSync(sb.out)).toBe(false)
    } finally {
      rmSync(sb.dir, { recursive: true, force: true })
    }
  })

  it('propagates the status line exit code and honours DOCKTERM_USAGE_FILE', () => {
    const sb = sandbox({ statusLine: { type: 'command', command: 'exit 3' } })
    try {
      const alt = join(sb.dir, 'alt.json')
      const r = sb.run(payload(), { DOCKTERM_USAGE_FILE: alt })
      expect(r.status).toBe(3)
      expect(existsSync(alt)).toBe(true)
      expect(existsSync(sb.out)).toBe(false)
    } finally {
      rmSync(sb.dir, { recursive: true, force: true })
    }
  })

  it('never delegates to itself', () => {
    const sb = sandbox({ statusLine: { type: 'command', command: 'sh "/x/usage-capture/usage-capture.sh"' } })
    try {
      expect(sb.run(payload())).toEqual({ stdout: '', status: 0 })
    } finally {
      rmSync(sb.dir, { recursive: true, force: true })
    }
  })
})
