import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterEach, describe, it, expect, vi } from 'vitest'

const watchSpy = vi.hoisted(() => vi.fn())
vi.mock('chokidar', () => ({ watch: watchSpy }))

import {
  hasIgnoredSegment,
  parseGitDirs,
  gitWatchPlan,
  resolveGitDirs,
  retargetWatcher,
  stopAllWatchers
} from '@main/services/watcherService'

describe('hasIgnoredSegment', () => {
  const root = join('/Users', 'me', 'projects', 'app')

  it('ignores node_modules under the root', () => {
    expect(hasIgnoredSegment(root, join(root, 'node_modules', 'x'))).toBe(true)
  })

  it('ignores a nested build dir under the root', () => {
    expect(hasIgnoredSegment(root, join(root, 'packages', 'x', 'dist', 'index.js'))).toBe(true)
  })

  it('does NOT ignore files when the PROJECT ITSELF sits inside a dir named like an ignored entry', () => {
    // The project root's own ancestor is literally called "build" — only
    // segments AT OR BELOW the root should count, not ones above it.
    const rootUnderBuild = join('/Users', 'me', 'build', 'app')
    expect(hasIgnoredSegment(rootUnderBuild, join(rootUnderBuild, 'src', 'index.ts'))).toBe(false)
  })

  it('does not ignore an ordinary source file', () => {
    expect(hasIgnoredSegment(root, join(root, 'src', 'index.ts'))).toBe(false)
  })

  it('is false for the root itself', () => {
    expect(hasIgnoredSegment(root, root)).toBe(false)
  })
})

describe('stopAllWatchers (Codex 13)', () => {
  afterEach(() => {
    vi.useRealTimers()
    watchSpy.mockReset()
  })

  it('cancels a pending retarget of a window whose watcher was never installed', async () => {
    vi.useFakeTimers()
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-watch-')))
    try {
      const win = { webContents: { id: 7701 }, isDestroyed: () => false } as never
      retargetWatcher(win, dir)
      stopAllWatchers()
      await vi.advanceTimersByTimeAsync(2000)
      expect(watchSpy).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('git metadata watch targets (Codex 14)', () => {
  it('parses --absolute-git-dir and a relative --git-common-dir against the root', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-gd-')))
    try {
      mkdirSync(join(root, '.git'))
      const dirs = parseGitDirs(`${join(root, '.git')}\n.git\n`, root)
      expect(dirs).toEqual({ gitDir: join(root, '.git'), commonDir: join(root, '.git') })
      expect(parseGitDirs('only-one-line\n', root)).toBeNull()
      expect(parseGitDirs('', root)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('plain repo: one target with HEAD, index and refs', () => {
    expect(gitWatchPlan({ gitDir: '/r/.git', commonDir: '/r/.git' })).toEqual([
      { dir: '/r/.git', allowed: ['HEAD', 'index', 'refs'] }
    ])
  })

  it('worktree: HEAD and index from its own dir, refs from the common dir', () => {
    expect(gitWatchPlan({ gitDir: '/main/.git/worktrees/w', commonDir: '/main/.git' })).toEqual([
      { dir: '/main/.git/worktrees/w', allowed: ['HEAD', 'index'] },
      { dir: '/main/.git', allowed: ['refs'] }
    ])
  })

  it('resolves the real git dir of a linked worktree, whose .git is a file', async () => {
    // .native expands Windows 8.3 short names (C:\Users\RUNNER~1), as git does.
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'dockterm-wt-')))
    try {
      const main = join(base, 'main')
      const wt = join(base, 'wt')
      mkdirSync(main)
      const g = (cwd: string, ...args: string[]): string =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          cwd,
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
        }).toString()
      g(main, 'init', '-q')
      writeFileSync(join(main, 'a.txt'), 'x')
      g(main, 'add', '.')
      g(main, 'commit', '-q', '-m', 'init')
      g(main, 'worktree', 'add', '-q', wt, '-b', 'feature')

      const plain = await resolveGitDirs(main)
      expect(plain).toEqual({ gitDir: join(main, '.git'), commonDir: join(main, '.git') })

      const linked = await resolveGitDirs(wt)
      expect(linked?.commonDir).toBe(join(main, '.git'))
      expect(linked?.gitDir).toBe(join(main, '.git', 'worktrees', 'wt'))
      const plan = gitWatchPlan(linked!)
      expect(plan.map((t) => t.dir)).toEqual([join(main, '.git', 'worktrees', 'wt'), join(main, '.git')])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('returns null outside a repository', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-nogit-')))
    try {
      expect(await resolveGitDirs(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
