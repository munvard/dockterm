import { existsSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import os from 'node:os'
import { git, autoGit } from './gitService'
import type { ProjectInfo } from '@shared/types'

export function detectGitRepo(path: string): boolean {
  return existsSync(join(path, '.git'))
}

export async function getBranch(path: string): Promise<string | null> {
  try {
    const branch = await (await autoGit(path)).raw(['rev-parse', '--abbrev-ref', 'HEAD'])
    const trimmed = branch.trim()
    return trimmed && trimmed !== 'HEAD' ? trimmed : null
  } catch {
    return null
  }
}

export async function inspectProject(path: string): Promise<ProjectInfo> {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error('Selected path is not a folder')
  }
  const isGitRepo = detectGitRepo(path)
  const branch = isGitRepo ? await getBranch(path) : null
  return { path, name: basename(path) || path, isGitRepo, branch }
}

/** A path is its own dirname only at a filesystem root ('/', 'C:\', …). A
 * terminal that reports (or a bug that resolves) its cwd as the filesystem
 * root must never become the app's project/watch/jail root. */
export function isFilesystemRoot(p: string): boolean {
  return dirname(p) === p
}

/** `git init` refuses the user's home directory and any filesystem root — the
 * "Initialize Git" banner/button confirms with an exact path first, but this is
 * the hard backstop regardless of which UI path called it. */
export function refuseGitInitTarget(path: string): string | null {
  if (isFilesystemRoot(path)) return 'Refusing to run git init at a filesystem root.'
  if (path === os.homedir()) return 'Refusing to run git init in your home folder.'
  return null
}

export async function initGitRepo(path: string): Promise<ProjectInfo> {
  const refusal = refuseGitInitTarget(path)
  if (refusal) throw new Error(refusal)
  await git(path).init(false)
  return inspectProject(path)
}
