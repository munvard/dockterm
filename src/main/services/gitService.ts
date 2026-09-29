import { simpleGit, type SimpleGit } from 'simple-git'
import os from 'node:os'
import { resolve, sep } from 'node:path'
import { statusToView, notRepoView } from './gitStatusMap'
import { readFile as readWorkingFile } from './fileService'
import type {
  GitStatusView,
  GitBranches,
  CommitResultView,
  GitFileStatus,
  ReviewBase,
  DiffSinceFile,
  DiffContent
} from '@shared/types'

/**
 * Every git invocation — from this service AND from projectService /
 * projectInfoService's lighter-weight lookups — goes through here.
 * `core.hooksPath=` neutralizes any hooks the (possibly untrusted) project repo
 * defines — opening a malicious repo must never run its code (CVE-2024-32002
 * class). `core.fsmonitor=false` stops a repo-local fsmonitor hook (an arbitrary
 * script honored automatically by plain `git status`) from auto-executing.
 * `GIT_TERMINAL_PROMPT=0` stops a push/pull from opening a native username/
 * password prompt that would block the main process; `GIT_OPTIONAL_LOCKS=0`
 * stops our own background status polls from racing a real `.git/index.lock`
 * (e.g. a commit the user is running by hand in the terminal at the same
 * moment). A block timeout stops a call from hanging forever if a credential
 * helper dialog is left open.
 */
export function git(root: string): SimpleGit {
  return simpleGit({
    baseDir: root,
    config: ['core.hooksPath=', 'core.fsmonitor=false'],
    unsafe: { allowUnsafeHooksPath: true, allowUnsafeFsMonitor: true },
    trimmed: true,
    timeout: { block: 120_000 }
  }).env({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' })
}

/** True for simple-git's own "not a git repository" rejection — the only case
 * `checkIsRepo()` is supposed to resolve `false` for. Every OTHER failure (dubious
 * ownership / safe.directory, permission errors, EMFILE, a timed-out credential
 * prompt, …) must surface as a real error instead of silently reading as "no
 * repo here", which used to show "Git not initialized" for a perfectly real repo. */
function isNotARepoError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  return /not a git repository/i.test(msg)
}

/** True when `toplevel` (git's own discovered repository root) IS the user's
 * home directory or an ancestor of it. A folder with no `.git` of its own that
 * happens to sit under a home-rooted dotfiles repo (`git init ~`, yadm,
 * chezmoi, …) would otherwise have git's normal upward repo discovery silently
 * treat that unrelated, much broader repo as "the" repo for this folder — so
 * status/stage/commit/push would act on ~ instead of reading as "not a repo". */
export function isSuspiciouslyBroadToplevel(toplevel: string): boolean {
  const t = resolve(toplevel)
  const home = resolve(os.homedir())
  return t === home || home.startsWith(t + sep)
}

export async function getStatus(root: string): Promise<GitStatusView> {
  const g = git(root)
  let isRepo: boolean
  try {
    isRepo = await g.checkIsRepo()
  } catch (e) {
    if (!isNotARepoError(e)) throw e
    isRepo = false
  }
  if (!isRepo) return notRepoView()

  try {
    const toplevel = await g.revparse(['--show-toplevel'])
    if (isSuspiciouslyBroadToplevel(toplevel)) return notRepoView()
  } catch (e) {
    if (!isNotARepoError(e)) throw e
    return notRepoView()
  }

  let hasCommits = true
  try {
    await g.revparse(['--verify', 'HEAD'])
  } catch {
    hasCommits = false
  }
  return statusToView(await g.status(), hasCommits)
}

export async function stage(root: string, paths: string[]): Promise<void> {
  await git(root).add(paths)
}

export async function stageAll(root: string): Promise<void> {
  await git(root).add(['-A'])
}

export async function unstage(root: string, paths: string[]): Promise<void> {
  await git(root).raw(['restore', '--staged', '--', ...paths])
}

export async function discard(root: string, paths: string[]): Promise<void> {
  await git(root).raw(['restore', '--', ...paths])
}

export async function commit(root: string, message: string): Promise<CommitResultView> {
  const result = await git(root).commit(message)
  const s = result.summary
  return {
    hash: result.commit || 'HEAD',
    summary: `${s.changes} file(s) changed, +${s.insertions} -${s.deletions}`
  }
}

export async function push(
  root: string,
  options: { setUpstream?: boolean; forceWithLease?: boolean }
): Promise<string> {
  const g = git(root)
  const args: string[] = []
  if (options.forceWithLease) args.push('--force-with-lease')
  if (options.setUpstream) {
    const branch = (await g.status()).current ?? 'HEAD'
    args.push('--set-upstream', 'origin', branch)
  }
  const result = await g.push(args)
  const updates = (result.pushed ?? []).length
  const remote = result.repo ?? 'remote'
  return `Pushed ${updates} ref(s) to ${remote}.`
}

export async function pull(root: string): Promise<string> {
  const r = await git(root).pull()
  return `Updated: ${r.summary.changes} change(s), +${r.summary.insertions} -${r.summary.deletions}.`
}

export async function branches(root: string): Promise<GitBranches> {
  const b = await git(root).branchLocal()
  return { current: b.current || null, all: b.all }
}

export async function createBranch(root: string, name: string): Promise<void> {
  await git(root).checkoutLocalBranch(name)
}

export async function switchBranch(root: string, name: string): Promise<void> {
  await git(root).checkout(name)
}

export async function deleteBranch(root: string, name: string): Promise<void> {
  // Non-force: git refuses to delete a branch with unmerged commits.
  await git(root).deleteLocalBranch(name, false)
}

export async function headHash(root: string): Promise<string> {
  return git(root).revparse(['HEAD'])
}

export async function isReachable(root: string, hash: string): Promise<boolean> {
  try {
    await git(root).raw(['cat-file', '-e', `${hash}^{commit}`])
    return true
  } catch {
    return false
  }
}

function parseNumstat(out: string): { path: string; ins: number; del: number }[] {
  const rows: { path: string; ins: number; del: number }[] = []
  for (const line of out.split('\n')) {
    const parts = line.trim().split('\t')
    if (parts.length < 3) continue
    const ins = parts[0] === '-' ? 0 : Number.parseInt(parts[0], 10) || 0
    const del = parts[1] === '-' ? 0 : Number.parseInt(parts[1], 10) || 0
    rows.push({ path: parts[2], ins, del })
  }
  return rows
}

/** Files changed relative to a baseline: the working tree (uncommitted), this
 * session (watcher-tracked), or a saved checkpoint commit. */
export async function changedSince(
  root: string,
  base: ReviewBase,
  checkpointHash: string | null,
  sessionPaths: string[]
): Promise<DiffSinceFile[]> {
  const g = git(root)

  if (base === 'checkpoint') {
    if (!checkpointHash) return []
    const numstat = await g.raw(['diff', '--numstat', checkpointHash])
    const files: DiffSinceFile[] = parseNumstat(numstat).map((n) => ({
      relPath: n.path,
      status: 'modified',
      insertions: n.ins,
      deletions: n.del
    }))
    const seen = new Set(files.map((f) => f.relPath))
    const status = await getStatus(root)
    for (const u of status.untracked) {
      if (!seen.has(u.path)) {
        files.push({ relPath: u.path, status: 'untracked', insertions: 0, deletions: 0 })
      }
    }
    return files
  }

  const status = await getStatus(root)
  const map = new Map<string, DiffSinceFile>()
  const add = (path: string, fileStatus: GitFileStatus): void => {
    if (!map.has(path)) map.set(path, { relPath: path, status: fileStatus, insertions: 0, deletions: 0 })
  }
  for (const f of status.staged) add(f.path, f.status)
  for (const f of status.unstaged) add(f.path, f.status)
  for (const f of status.untracked) add(f.path, 'untracked')

  try {
    for (const n of parseNumstat(await g.raw(['diff', '--numstat', 'HEAD']))) {
      const entry = map.get(n.path)
      if (entry) {
        entry.insertions = n.ins
        entry.deletions = n.del
      }
    }
  } catch {
    // empty repo: no HEAD to diff against
  }

  let files = [...map.values()]
  if (base === 'session') {
    const allowed = new Set(sessionPaths)
    files = files.filter((f) => allowed.has(f.relPath))
  }
  return files
}

/** Original (baseline) and current content for a single file's diff view. */
export async function diffFile(
  root: string,
  base: ReviewBase,
  checkpointHash: string | null,
  relPath: string
): Promise<DiffContent> {
  const ref = base === 'checkpoint' && checkpointHash ? checkpointHash : 'HEAD'
  let original = ''
  try {
    original = await git(root).show([`${ref}:${relPath}`])
  } catch {
    original = '' // new file, or no baseline commit
  }
  let modified = ''
  try {
    const result = await readWorkingFile(root, relPath)
    modified = result.kind === 'text' ? result.content : ''
  } catch {
    modified = '' // deleted in the working tree
  }
  return { relPath, original, modified }
}
