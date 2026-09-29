import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { Result } from '@shared/result'
import {
  detectExecConfig,
  pendingExecConfig,
  trustRepo,
  clearTrustedRepos
} from '@main/services/gitTrust'
import { registerGitHandlers } from '@main/ipc/handlers/git'
import { setActiveRoot, clearActiveRoot } from '@main/services/activeRoot'

/** Build `git config --local --null --list` output from key/value pairs. */
const cfg = (pairs: [string, string | null][]): string =>
  pairs.map(([k, v]) => (v === null ? k : `${k}\n${v}`)).join('\0') + '\0'

const keys = (pairs: [string, string | null][]): string[] =>
  detectExecConfig(cfg(pairs)).map((e) => e.key)

describe('detectExecConfig', () => {
  it('ignores ordinary repo config', () => {
    expect(
      keys([
        ['core.repositoryformatversion', '0'],
        ['core.filemode', 'true'],
        ['core.bare', 'false'],
        ['remote.origin.url', 'https://example.com/a.git'],
        ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
        ['branch.main.remote', 'origin'],
        ['user.name', 'Ann'],
        ['filter.lfs.required', 'true']
      ])
    ).toEqual([])
  })

  it('flags filter drivers', () => {
    expect(
      keys([
        ['filter.x.clean', 'evil'],
        ['filter.x.smudge', 'evil'],
        ['filter.x.process', 'evil']
      ])
    ).toEqual(['filter.x.clean', 'filter.x.smudge', 'filter.x.process'])
  })

  it('flags the other command-running keys', () => {
    const found = keys([
      ['core.sshcommand', 'sh -c evil'],
      ['core.hookspath', '/tmp/hooks'],
      ['core.editor', 'evil'],
      ['core.pager', 'evil'],
      ['sequence.editor', 'evil'],
      ['credential.helper', '!evil'],
      ['credential.https://example.com.helper', '!evil'],
      ['diff.x.textconv', 'evil'],
      ['diff.x.command', 'evil'],
      ['merge.x.driver', 'evil %A'],
      ['gpg.program', 'evil'],
      ['gpg.ssh.program', 'evil'],
      ['remote.origin.uploadpack', 'evil'],
      ['remote.origin.receivepack', 'evil'],
      ['uploadpack.packobjectshook', 'evil']
    ])
    expect(found).toHaveLength(15)
  })

  it('flags core.fsmonitor only when it is a command, not a boolean', () => {
    expect(keys([['core.fsmonitor', '/tmp/hook']])).toEqual(['core.fsmonitor'])
    expect(keys([['core.fsmonitor', 'true']])).toEqual([])
    expect(keys([['core.fsmonitor', 'false']])).toEqual([])
    expect(keys([['core.fsmonitor', null]])).toEqual([])
  })

  it('is case-insensitive on section and variable names', () => {
    expect(keys([['FILTER.x.CLEAN', 'evil']])).toEqual(['FILTER.x.CLEAN'])
    expect(keys([['Core.SshCommand', 'evil']])).toEqual(['Core.SshCommand'])
    expect(keys([['CREDENTIAL.HELPER', 'store']])).toEqual(['CREDENTIAL.HELPER'])
  })

  it('flags url.<base>.insteadOf when the base is an ext:: or fd:: transport', () => {
    expect(keys([['url.ext::sh -c evil.insteadof', 'https://example.com/']])).toHaveLength(1)
    expect(keys([['url.EXT::sh -c evil.pushinsteadof', 'https://example.com/']])).toHaveLength(1)
    expect(keys([['url.fd::3.insteadof', 'x']])).toHaveLength(1)
    expect(keys([['url.git@github.com:.insteadof', 'https://github.com/']])).toEqual([])
    expect(keys([['url.https://example.com/.insteadof', 'ext::']])).toEqual([])
  })

  it('flags a remote url that is an ext:: transport', () => {
    expect(keys([['remote.origin.url', 'ext::sh -c evil']])).toEqual(['remote.origin.url'])
  })

  it('flags protocol.allow and protocol.ext.allow unless "never"', () => {
    expect(keys([['protocol.allow', 'always']])).toEqual(['protocol.allow'])
    expect(keys([['protocol.ext.allow', 'always']])).toEqual(['protocol.ext.allow'])
    expect(keys([['protocol.ext.allow', 'never']])).toEqual([])
    expect(keys([['protocol.file.allow', 'always']])).toEqual([])
  })

  it('keeps values with newlines and truncates long ones to 200 chars', () => {
    const long = 'x'.repeat(500)
    const [e] = detectExecConfig(cfg([['filter.x.clean', long]]))
    expect(e.value.length).toBe(201)
    expect(e.value.startsWith('x'.repeat(200))).toBe(true)
    const [multi] = detectExecConfig(cfg([['core.editor', 'a\nb']]))
    expect(multi.value).toBe('a\nb')
  })

  it('returns nothing for empty output', () => {
    expect(detectExecConfig('')).toEqual([])
  })
})

describe('pendingExecConfig', () => {
  beforeEach(() => clearTrustedRepos())

  it('reports the keys from the reader, then nothing once trusted', async () => {
    const root = tmpdir()
    const reader = async (): Promise<string> => cfg([['filter.x.clean', 'evil']])
    expect(await pendingExecConfig(root, reader)).toEqual([{ key: 'filter.x.clean', value: 'evil' }])
    trustRepo(root)
    expect(await pendingExecConfig(root, reader)).toEqual([])
  })

  it('treats "not a git repository" as no config, but rethrows other failures', async () => {
    const notRepo = async (): Promise<string> => {
      throw new Error('fatal: not a git repository')
    }
    expect(await pendingExecConfig(tmpdir(), notRepo)).toEqual([])
    const broken = async (): Promise<string> => {
      throw new Error('spawn git ENOENT')
    }
    await expect(pendingExecConfig(tmpdir(), broken)).rejects.toThrow('ENOENT')
  })
})

type Handler = (req: unknown, event: IpcMainInvokeEvent) => Promise<Result<unknown>> | Result<unknown>

describe('git handlers: trust gate (real temp repo)', () => {
  const WIN = 4242
  const event = { sender: { id: WIN } } as unknown as IpcMainInvokeEvent
  const handlers = new Map<string, Handler>()
  let dir: string
  // simple-git refuses to run when an editor/pager variable is in the
  // environment (GIT_EDITOR is set under Claude Code); keep the test independent
  // of the developer's shell.
  const EDITOR_VARS = ['GIT_EDITOR', 'EDITOR', 'VISUAL', 'PAGER', 'GIT_PAGER']
  const savedEnv = EDITOR_VARS.map((k) => [k, process.env[k]] as const)

  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  const call = async (channel: string, req?: unknown): Promise<Result<unknown>> => {
    const h = handlers.get(channel)
    if (!h) throw new Error(`no handler ${channel}`)
    return h(req, event)
  }

  beforeEach(() => {
    for (const k of EDITOR_VARS) delete process.env[k]
    clearTrustedRepos()
    handlers.clear()
    registerGitHandlers(((channel: string, _schema: unknown, handler: Handler) => {
      handlers.set(channel, handler)
    }) as never)
    dir = mkdtempSync(join(tmpdir(), 'dockterm-gate-'))
    run(['init', '-q'])
    // A harmless stand-in for a hostile filter driver.
    run(['config', 'filter.probe.clean', 'cat'])
    writeFileSync(join(dir, '.gitattributes'), '* filter=probe\n')
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    setActiveRoot(WIN, dir)
  })

  afterEach(() => {
    for (const [k, v] of savedEnv) if (v !== undefined) process.env[k] = v
    clearActiveRoot(WIN)
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses every write op with UNTRUSTED_GIT_CONFIG and the key=value list', async () => {
    const ops: [string, unknown][] = [
      ['git:stage', { paths: ['a.txt'] }],
      ['git:stageAll', undefined],
      ['git:unstage', { paths: ['a.txt'] }],
      ['git:discard', { paths: ['a.txt'] }],
      ['git:commit', { message: 'm' }],
      ['git:push', {}],
      ['git:pull', undefined],
      ['git:createBranch', { name: 'b' }],
      ['git:switchBranch', { name: 'b' }],
      ['git:deleteBranch', { name: 'b' }]
    ]
    for (const [channel, req] of ops) {
      const res = await call(channel, req)
      expect(res.ok, channel).toBe(false)
      if (res.ok) continue
      expect(res.error.code, channel).toBe('UNTRUSTED_GIT_CONFIG')
      const d = res.error.details as { root: string; entries: { key: string; value: string }[] }
      expect(d.entries).toEqual([{ key: 'filter.probe.clean', value: 'cat' }])
    }
  })

  it('leaves the read-only handlers alone', async () => {
    const st = await call('git:status')
    expect(st.ok).toBe(true)
    expect((await call('git:branches')).ok).toBe(true)
  })

  it('does not stage anything while blocked, and succeeds after trust', async () => {
    await call('git:stage', { paths: ['a.txt'] })
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString()
    expect(staged.trim()).toBe('')

    expect((await call('git:trustRepo', { root: dir })).ok).toBe(true)
    const res = await call('git:stage', { paths: ['a.txt'] })
    expect(res.ok).toBe(true)
    const after = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: dir }).toString()
    expect(after.trim()).toBe('a.txt')
  })

  it('refuses to trust a root other than the window\'s active repo', async () => {
    const res = await call('git:trustRepo', { root: tmpdir() })
    expect(res.ok).toBe(false)
    const still = await call('git:stage', { paths: ['a.txt'] })
    expect(still.ok).toBe(false)
  })

  it('does not gate a repo with no command-running config', async () => {
    run(['config', '--unset', 'filter.probe.clean'])
    const res = await call('git:stage', { paths: ['a.txt'] })
    expect(res.ok).toBe(true)
  })

  it('sees keys pulled in through include.path', async () => {
    run(['config', '--unset', 'filter.probe.clean'])
    const inc = join(dir, 'extra.cfg')
    writeFileSync(inc, '[core]\n\tsshCommand = evil\n')
    run(['config', 'include.path', inc])
    const res = await call('git:push', {})
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('UNTRUSTED_GIT_CONFIG')
    }
  })
})
