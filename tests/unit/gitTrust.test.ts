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

type Row = [string, string | null] | [string, string | null, string]

/** Build `git config --list --show-scope --includes --null` output: each entry
 * is `scope NUL key NEWLINE value NUL`. Rows default to the repo's local scope. */
const cfg = (rows: Row[]): string =>
  rows
    .map((r) => {
      const [key, value] = r
      const scope = r[2] ?? 'local'
      return `${scope}\0${value === null ? key : `${key}\n${value}`}\0`
    })
    .join('')

const keys = (rows: Row[]): string[] => detectExecConfig(cfg(rows)).map((e) => e.key)

describe('detectExecConfig', () => {
  it('passes a typical repo config (allowlist)', () => {
    expect(
      keys([
        ['core.repositoryformatversion', '0'],
        ['core.filemode', 'true'],
        ['core.bare', 'false'],
        ['core.logallrefupdates', 'true'],
        ['core.ignorecase', 'true'],
        ['core.precomposeunicode', 'true'],
        ['core.autocrlf', 'input'],
        ['user.name', 'Ann'],
        ['user.email', 'a@example.com'],
        ['remote.origin.url', 'https://example.com/a.git'],
        ['remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
        ['remote.origin.tagopt', '--no-tags'],
        ['branch.main.remote', 'origin'],
        ['branch.main.merge', 'refs/heads/main'],
        ['branch.main.rebase', 'true'],
        ['extensions.partialclone', 'origin'],
        ['gc.auto', '0'],
        ['pack.threads', '2'],
        ['index.version', '4'],
        ['feature.manyfiles', 'true'],
        ['pull.rebase', 'true'],
        ['push.default', 'current'],
        ['push.autosetupremote', 'true'],
        ['fetch.prune', 'true'],
        ['rebase.autostash', 'true'],
        ['merge.conflictstyle', 'zdiff3'],
        ['diff.algorithm', 'histogram'],
        ['color.ui', 'auto'],
        ['commit.gpgsign', 'false'],
        ['lfs.url', 'https://lfs.example.com'],
        ['submodule.lib.url', 'https://example.com/lib.git'],
        ['submodule.lib.active', 'true'],
        ['submodule.lib.update', 'checkout'],
        ['url.git@github.com:.insteadof', 'https://github.com/']
      ])
    ).toEqual([])
  })

  it('flags an unknown key (allowlist, not denylist)', () => {
    expect(keys([['alias.co', '!evil']])).toEqual(['alias.co'])
    expect(keys([['some.future.key', 'x']])).toEqual(['some.future.key'])
    expect(keys([['core.somethingnew', 'x']])).toEqual(['core.somethingnew'])
    expect(keys([['branch.main.mergeoptions', '--x']])).toEqual(['branch.main.mergeoptions'])
  })

  it('flags command-running keys, including ones a denylist would miss', () => {
    const found = keys([
      ['filter.x.clean', 'evil'],
      ['filter.x.smudge', 'evil'],
      ['filter.x.process', 'evil'],
      ['core.sshcommand', 'sh -c evil'],
      ['core.hookspath', '/tmp/hooks'],
      ['core.fsmonitor', '/tmp/hook'],
      ['core.editor', 'evil'],
      ['core.pager', 'evil'],
      ['core.askpass', 'evil'],
      ['core.gitproxy', 'evil'],
      ['core.alternaterefscommand', 'evil'],
      ['sequence.editor', 'evil'],
      ['credential.helper', '!evil'],
      ['credential.https://example.com.helper', '!evil'],
      ['diff.x.textconv', 'evil'],
      ['diff.x.command', 'evil'],
      ['diff.external', 'evil'],
      ['merge.x.driver', 'evil %A'],
      ['interactive.difffilter', 'evil'],
      ['trailer.x.command', 'evil'],
      ['gpg.program', 'evil'],
      ['gpg.ssh.program', 'evil'],
      ['pager.log', 'evil'],
      ['remote.origin.uploadpack', 'evil'],
      ['remote.origin.receivepack', 'evil'],
      ['remote.origin.vcs', 'evil'],
      ['uploadpack.packobjectshook', 'evil'],
      ['protocol.allow', 'always'],
      ['protocol.ext.allow', 'always'],
      ['commit.gpgsign', 'true'],
      ['submodule.lib.update', '!evil'],
      ['lfs.customtransfer.x.path', 'evil'],
      ['lfs.standalonetransferagent', 'x']
    ])
    expect(found).toHaveLength(33)
  })

  it('flags core.fsmonitor even as a boolean (not on the allowlist; git() forces it off anyway)', () => {
    expect(keys([['core.fsmonitor', 'true']])).toEqual(['core.fsmonitor'])
  })

  it('is case-insensitive on section and variable names', () => {
    expect(keys([['FILTER.x.CLEAN', 'evil']])).toEqual(['FILTER.x.CLEAN'])
    expect(keys([['Core.SshCommand', 'evil']])).toEqual(['Core.SshCommand'])
    expect(keys([['CREDENTIAL.HELPER', 'store']])).toEqual(['CREDENTIAL.HELPER'])
    expect(keys([['CORE.FileMode', 'true']])).toEqual([])
  })

  it('flags include.path and includeIf.<cond>.path on their own', () => {
    expect(keys([['include.path', '../evil.cfg']])).toEqual(['include.path'])
    expect(keys([['includeif.gitdir:/work/.path', '../evil.cfg']])).toEqual([
      'includeif.gitdir:/work/.path'
    ])
    expect(keys([['includeIf.onbranch:main.path', 'x']])).toHaveLength(1)
  })

  it('reads worktree-scope entries as repo-controlled, and ignores user scopes', () => {
    expect(keys([['filter.w.clean', 'evil', 'worktree']])).toEqual(['filter.w.clean'])
    expect(keys([['filter.g.clean', 'git-lfs clean', 'global']])).toEqual([])
    expect(keys([['credential.helper', 'osxkeychain', 'system']])).toEqual([])
    expect(keys([['core.hookspath', '', 'command']])).toEqual([])
    expect(keys([['core.sshcommand', 'evil', 'unknown']])).toEqual([])
  })

  it('flags ext:: / fd:: in remote and submodule urls and url.*.insteadOf, even though those keys are allowed', () => {
    expect(keys([['remote.origin.url', 'ext::sh -c evil']])).toEqual(['remote.origin.url'])
    expect(keys([['remote.origin.pushurl', 'EXT::sh -c evil']])).toEqual(['remote.origin.pushurl'])
    expect(keys([['remote.origin.url', 'fd::3']])).toHaveLength(1)
    expect(keys([['submodule.lib.url', 'ext::sh -c evil']])).toHaveLength(1)
    expect(keys([['url.ext::sh -c evil.insteadof', 'https://example.com/']])).toHaveLength(1)
    expect(keys([['url.fd::3.pushinsteadof', 'x']])).toHaveLength(1)
    expect(keys([['url.https://example.com/.insteadof', 'ext::']])).toHaveLength(1)
    expect(keys([['remote.origin.url', 'git@example.com:a/b.git']])).toEqual([])
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
      const d = res.error.details as { entries: { key: string }[] }
      const found = d.entries.map((e) => e.key)
      expect(found).toContain('include.path')
      expect(found).toContain('core.sshcommand')
    }
  })

  it('sees keys in worktree-scope config (extensions.worktreeConfig)', async () => {
    run(['config', '--unset', 'filter.probe.clean'])
    run(['config', 'extensions.worktreeConfig', 'true'])
    run(['config', '--worktree', 'core.sshCommand', 'evil'])
    const res = await call('git:push', {})
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('UNTRUSTED_GIT_CONFIG')
  })

  it('does not trust the user\'s own global config', async () => {
    run(['config', '--unset', 'filter.probe.clean'])
    const res = await call('git:stage', { paths: ['a.txt'] })
    expect(res.ok).toBe(true)
  })
})
