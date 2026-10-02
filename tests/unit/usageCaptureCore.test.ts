import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  CAPTURE_WRAPPER_SH,
  captureCommand,
  captureSettingsJson,
  nextExpiry,
  nodeOnPath,
  pruneExpired,
  sameRealUsage,
  settingsFlagText,
  toRealUsage,
  userStatusLine
} from '@main/services/usageCaptureCore'

const NOW = 1_790_000_000_000

const file = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  updatedAt: NOW - 1000,
  limitsAt: NOW - 1000,
  fiveHour: { pct: 6, resetsAt: NOW / 1000 + 3600 },
  sevenDay: { pct: 28, resetsAt: NOW / 1000 + 86400 },
  sessionId: 's',
  context: { pct: 29, size: 200000 },
  model: { id: 'claude-opus-5-5', name: 'Opus' },
  costUsd: 1.5,
  ...over
})

describe('toRealUsage', () => {
  it('converts the capture file (epoch seconds) into RealUsage (epoch ms)', () => {
    expect(toRealUsage(file(), NOW)).toEqual({
      fiveHour: { pct: 6, resetsAt: NOW + 3_600_000 },
      sevenDay: { pct: 28, resetsAt: NOW + 86_400_000 },
      updatedAt: NOW - 1000,
      capturedAt: NOW - 1000,
      contextPct: 29,
      model: 'Opus',
      costUsd: 1.5
    })
  })

  it('drops a window whose reset time has passed (as Claude does)', () => {
    const r = toRealUsage(file({ fiveHour: { pct: 90, resetsAt: NOW / 1000 - 1 } }), NOW)!
    expect(r.fiveHour).toBeNull()
    expect(r.sevenDay).not.toBeNull()
  })

  it('keeps an absent window null and never invents a number', () => {
    const r = toRealUsage(file({ fiveHour: null, sevenDay: null, limitsAt: null, context: null, model: null, costUsd: null }), NOW)!
    expect(r).toEqual({
      fiveHour: null,
      sevenDay: null,
      updatedAt: null,
      capturedAt: NOW - 1000,
      contextPct: null,
      model: null,
      costUsd: null
    })
  })

  it('rejects anything that is not a capture file of this format', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { v: 2, updatedAt: 1 }, { v: 1 }, { v: 1, updatedAt: 'now' }]) {
      expect(toRealUsage(bad, NOW)).toBeNull()
    }
  })

  it('ignores malformed windows and non-finite numbers', () => {
    const r = toRealUsage(file({ fiveHour: { pct: 'x', resetsAt: NOW }, sevenDay: { pct: 5 }, costUsd: Infinity }), NOW)!
    expect(r.fiveHour).toBeNull()
    expect(r.sevenDay).toBeNull()
    expect(r.costUsd).toBeNull()
  })

  it('falls back to the model id when there is no display name', () => {
    expect(toRealUsage(file({ model: { id: 'claude-x', name: null } }), NOW)!.model).toBe('claude-x')
  })
})

describe('pruneExpired / nextExpiry / sameRealUsage', () => {
  const real = toRealUsage(file(), NOW)!
  it('pruneExpired returns the same object while nothing has expired', () => {
    expect(pruneExpired(real, NOW)).toBe(real)
    expect(pruneExpired(null, NOW)).toBeNull()
  })
  it('pruneExpired drops only the window that has reset', () => {
    const p = pruneExpired(real, NOW + 3_600_000)!
    expect(p.fiveHour).toBeNull()
    expect(p.sevenDay).toEqual(real.sevenDay)
  })
  it('nextExpiry is the soonest reset, or null with no windows', () => {
    expect(nextExpiry(real)).toBe(NOW + 3_600_000)
    expect(nextExpiry({ ...real, fiveHour: null })).toBe(NOW + 86_400_000)
    expect(nextExpiry({ ...real, fiveHour: null, sevenDay: null })).toBeNull()
    expect(nextExpiry(null)).toBeNull()
  })
  it('sameRealUsage compares by value', () => {
    expect(sameRealUsage(real, structuredClone(real))).toBe(true)
    expect(sameRealUsage(real, { ...real, costUsd: 9 })).toBe(false)
    expect(sameRealUsage(real, { ...real, fiveHour: { pct: 7, resetsAt: real.fiveHour!.resetsAt } })).toBe(false)
    expect(sameRealUsage(real, null)).toBe(false)
    expect(sameRealUsage(null, null)).toBe(true)
  })
})

describe('userStatusLine', () => {
  it('reads command, padding and refreshInterval', () => {
    expect(userStatusLine({ statusLine: { type: 'command', command: '~/.claude/statusline.sh', padding: 0, refreshInterval: 60 } })).toEqual({
      command: '~/.claude/statusline.sh',
      padding: 0,
      refreshInterval: 60
    })
  })
  it('returns null when there is no usable status line', () => {
    for (const s of [null, {}, { statusLine: null }, { statusLine: { type: 'command' } }, { statusLine: { type: 'command', command: '  ' } }, { statusLine: { type: 'other', command: 'x' } }]) {
      expect(userStatusLine(s)).toBeNull()
    }
  })
  it('drops invalid padding / refreshInterval', () => {
    expect(userStatusLine({ statusLine: { type: 'command', command: 'x', padding: -1, refreshInterval: 0 } })).toEqual({
      command: 'x',
      padding: null,
      refreshInterval: null
    })
  })
})

describe('captureCommand', () => {
  it('posix: sh wrapper, path quoted (spaces ok) and shell-special characters escaped', () => {
    expect(captureCommand('/Users/me/Library/Application Support/DockTerm/usage-capture', 'darwin')).toBe(
      'sh "/Users/me/Library/Application Support/DockTerm/usage-capture/usage-capture.sh"'
    )
    expect(captureCommand('/home/a"b$c`d\\e', 'linux')).toBe('sh "/home/a\\"b\\$c\\`d\\\\e/usage-capture.sh"')
  })
  it('windows: node with a forward-slash path (valid in Git Bash and PowerShell)', () => {
    expect(captureCommand('C:\\Users\\Me Me\\AppData\\Roaming\\DockTerm\\usage-capture', 'win32')).toBe(
      'node "C:/Users/Me Me/AppData/Roaming/DockTerm/usage-capture/usage-capture.cjs"'
    )
    expect(captureCommand("C:\\Users\\O'Brien\\x", 'win32')).toContain("O'Brien")
  })
  it('windows: refuses a path it cannot quote the same way in every shell', () => {
    expect(captureCommand('C:\\Users\\a$b\\x', 'win32')).toBeNull()
    expect(captureCommand('C:\\Users\\a%b\\x', 'win32')).toBeNull()
  })
})

describe('captureSettingsJson', () => {
  const user = { command: 'x', padding: 0, refreshInterval: 60 }
  it('sets only statusLine, mirroring the user padding and refreshInterval', () => {
    const j = JSON.parse(captureSettingsJson('sh "/x"', user))
    expect(j).toEqual({ statusLine: { type: 'command', command: 'sh "/x"', padding: 0, refreshInterval: 60 } })
  })
  it('adds neither when the user has no status line', () => {
    expect(JSON.parse(captureSettingsJson('sh "/x"', null))).toEqual({ statusLine: { type: 'command', command: 'sh "/x"' } })
  })
})

describe('nodeOnPath', () => {
  it('finds node.exe on a Windows PATH and ignores empty entries and quotes', () => {
    const exists = (p: string): boolean => p === 'C:\\Program Files\\nodejs\\node.exe'
    expect(nodeOnPath('C:\\x;;"C:\\Program Files\\nodejs"', 'win32', exists)).toBe(true)
    expect(nodeOnPath('C:\\x;C:\\y', 'win32', exists)).toBe(false)
  })
  it('finds node on a posix PATH', () => {
    expect(nodeOnPath('/a:/opt/homebrew/bin', 'darwin', (p) => p === '/opt/homebrew/bin/node')).toBe(true)
  })
})

describe('settingsFlagText', () => {
  it('windows: double quotes; posix: single quotes with embedded quotes escaped', () => {
    expect(settingsFlagText('C:\\Users\\Me Me\\s.json', 'win32')).toBe('--settings "C:\\Users\\Me Me\\s.json"')
    expect(settingsFlagText("/Users/o'b/x y/s.json", 'darwin')).toBe(`--settings '/Users/o'\\''b/x y/s.json'`)
  })
  it('the posix flag survives a real shell round trip', () => {
    if (process.platform === 'win32') return
    const p = "/tmp/a b'c/s.json"
    const r = spawnSync('sh', ['-c', `printf '%s' ${settingsFlagText(p, 'darwin').replace('--settings ', '')}`], { encoding: 'utf8' })
    expect(r.stdout).toBe(p)
  })
})

const hasNode = (): boolean => ['/usr/bin/node', '/bin/node', '/usr/local/bin/node'].some((p) => existsSync(p))

describe.skipIf(process.platform === 'win32')('capture wrapper (sh)', () => {
  function setup(delegate: string): { dir: string; run: (path: string) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'dockterm-wrap-'))
    const w = join(dir, 'w d')
    mkdirSync(w)
    writeFileSync(join(w, 'usage-capture.sh'), CAPTURE_WRAPPER_SH)
    writeFileSync(join(w, 'usage-capture.cjs'), 'console.log("CAPTURE-RAN")\n')
    writeFileSync(join(w, 'usage-delegate.txt'), delegate)
    const fakeBin = join(dir, 'bin')
    mkdirSync(fakeBin)
    writeFileSync(join(fakeBin, 'node'), '#!/bin/sh\necho "FAKE-NODE $*"\n')
    chmodSync(join(fakeBin, 'node'), 0o755)
    return {
      dir,
      run: (path) => spawnSync('/bin/sh', [join(w, 'usage-capture.sh')], { input: 'IN', env: { PATH: path }, encoding: 'utf8' }).stdout
    }
  }
  it('uses node when it is on PATH', () => {
    const { dir, run } = setup('echo DELEGATE')
    try {
      const out = run(`${join(dir, 'bin')}:/usr/bin:/bin`)
      expect(out).toContain('FAKE-NODE')
      expect(out).toContain('usage-capture.cjs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it.skipIf(hasNode())('without node runs the saved user status line with the same stdin', () => {
    const { dir, run } = setup('cat; echo " <-delegate"')
    try {
      expect(run('/usr/bin:/bin')).toBe('IN <-delegate\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it.skipIf(hasNode())('without node and without a saved status line prints nothing', () => {
    const { dir, run } = setup('')
    try {
      expect(run('/usr/bin:/bin')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

