import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitEnv } from '@main/services/gitCore'
import { getStatus } from '@main/services/gitService'
import { filterDriverNames, filterOverrides, clearTrustedRepos } from '@main/services/gitTrust'
import { mapGitError } from '@main/ipc/handlers/git'

const BLOCKED = [
  'EDITOR',
  'PAGER',
  'PREFIX',
  'GIT_EDITOR',
  'GIT_PAGER',
  'GIT_SEQUENCE_EDITOR',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_PROXY_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_KEY_0',
  'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR'
]

describe('gitEnv', () => {
  const base = Object.fromEntries([...BLOCKED.map((k) => [k, 'x']), ['HOME', '/h'], ['PATH', '/bin']])

  it('removes every variable simple-git refuses', () => {
    const env = gitEnv(base)
    for (const k of BLOCKED) expect(env, k).not.toHaveProperty(k)
    expect(env.HOME).toBe('/h')
    expect(env.PATH).toBe('/bin')
  })

  it('matches names case-insensitively (Windows)', () => {
    const env = gitEnv({ Editor: 'vim', Prefix: '/usr/local', git_ssh_command: 'ssh -v', Git_Config_Global: '/g', Path: 'p' })
    expect(Object.keys(env).sort()).toEqual(['GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', 'Path'])
  })

  it('keeps GIT_TERMINAL_PROMPT=0 and GIT_OPTIONAL_LOCKS=0 and overrides the user values', () => {
    const env = gitEnv({ GIT_TERMINAL_PROMPT: '1', git_optional_locks: '1' })
    expect(env).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' })
  })

  it('does not mutate the input', () => {
    const input = { EDITOR: 'vim' }
    gitEnv(input)
    expect(input).toEqual({ EDITOR: 'vim' })
  })

  it('keeps only the user\'s own transport and credential vars for a user network op', () => {
    const env = gitEnv(base, { userNetworkOp: true })
    for (const k of ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PROXY_COMMAND']) {
      expect(env[k], k).toBe('x')
    }
    for (const k of ['EDITOR', 'PAGER', 'PREFIX', 'GIT_EDITOR', 'GIT_CONFIG_GLOBAL', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR', 'GIT_EXTERNAL_DIFF']) {
      expect(env, k).not.toHaveProperty(k)
    }
  })

  it('never treats an "unsafe" simple-git error as "not a repo"', () => {
    const res = mapGitError(new Error('Use of "EDITOR" is not permitted without enabling allowUnsafeEditor'))
    expect(res.ok).toBe(false)
    expect(res.error.code).not.toBe('NOT_REPO')
  })
})

describe('git through the service with a hostile-looking environment', () => {
  let dir: string
  const saved = new Map<string, string | undefined>()
  const setEnv = (k: string, v: string): void => {
    if (!saved.has(k)) saved.set(k, process.env[k])
    process.env[k] = v
  }
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }

  beforeEach(() => {
    clearTrustedRepos()
    dir = mkdtempSync(join(tmpdir(), 'dockterm-env-'))
    run(['init', '-q'])
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
  })
  afterEach(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    saved.clear()
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads status with EDITOR, PAGER, PREFIX and GIT_* helpers in the environment', async () => {
    setEnv('EDITOR', 'vim')
    setEnv('PAGER', 'less')
    setEnv('PREFIX', '/usr/local')
    setEnv('GIT_EDITOR', 'vim')
    setEnv('GIT_ASKPASS', '/bin/false')
    setEnv('GIT_SSH_COMMAND', 'ssh -v')
    setEnv('GIT_CONFIG_GLOBAL', '/nonexistent')
    const status = await getStatus(dir)
    expect(status.repoState).not.toBe('not-repo')
    expect(status.untracked.map((f) => f.path)).toEqual(['a.txt'])
  })
})

describe('filter overrides', () => {
  it('names each filter driver once', () => {
    expect(
      filterDriverNames([
        { key: 'filter.lfs.clean', value: 'x' },
        { key: 'filter.lfs.smudge', value: 'x' },
        { key: 'core.sshCommand', value: 'x' },
        { key: 'filter.a.b.process', value: 'x' }
      ])
    ).toEqual(['lfs', 'a.b'])
  })

  it('empties clean / smudge / process and turns required off', () => {
    expect(filterOverrides(['probe'])).toEqual([
      'filter.probe.clean=',
      'filter.probe.smudge=',
      'filter.probe.process=',
      'filter.probe.required=false'
    ])
  })

  it('fails closed on a name -c cannot express', () => {
    expect(() => filterOverrides(['a=b'])).toThrow()
  })
})
