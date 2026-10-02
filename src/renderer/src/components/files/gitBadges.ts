import type { GitFileStatus, GitStatusView } from '@shared/types'

export interface GitBadge {
  letter: string
  cls: 'mod' | 'add' | 'del' | 'ren' | 'unt' | 'con'
}

const BADGE: Record<GitFileStatus, GitBadge> = {
  modified: { letter: 'M', cls: 'mod' },
  added: { letter: 'A', cls: 'add' },
  deleted: { letter: 'D', cls: 'del' },
  renamed: { letter: 'R', cls: 'ren' },
  copied: { letter: 'C', cls: 'add' },
  typechange: { letter: 'T', cls: 'mod' },
  untracked: { letter: 'U', cls: 'unt' },
  conflicted: { letter: '!', cls: 'con' }
}

/** Which badge wins when a file (or a folder holding several) has more than one state. */
const RANK: Record<GitBadge['cls'], number> = { unt: 1, add: 2, ren: 3, del: 4, mod: 5, con: 6 }

export interface GitBadgeMap {
  /** Badge for a file or folder, or null when it is clean. */
  get(relPath: string): GitBadge | null
  /** True when the path is a folder that holds a change (shown as a dot). */
  isFolderMark(relPath: string): boolean
  size: number
}

const EMPTY: GitBadgeMap = { get: () => null, isFolderMark: () => false, size: 0 }

/**
 * Badges for every changed file, and for every folder above one (the strongest
 * state inside it). The project root is assumed to be the git root: paths in the
 * status are relative to the repo, which is the same place.
 */
export function buildGitBadges(status: GitStatusView | null): GitBadgeMap {
  if (!status || status.repoState === 'not-repo') return EMPTY
  const files = new Map<string, GitBadge>()
  const folders = new Map<string, GitBadge>()
  const untrackedDirs: string[] = []
  const put = (path: string, badge: GitBadge): void => {
    const prev = files.get(path)
    if (!prev || RANK[badge.cls] > RANK[prev.cls]) files.set(path, badge)
  }
  const all = [...status.unstaged, ...status.staged, ...status.untracked, ...status.conflicted]
  for (const entry of all) {
    const badge = BADGE[entry.status]
    if (entry.path.endsWith('/')) {
      untrackedDirs.push(entry.path.replace(/\/+$/, ''))
      put(entry.path.replace(/\/+$/, ''), badge)
    } else {
      put(entry.path, badge)
    }
  }
  for (const [path, badge] of files) {
    let i = path.lastIndexOf('/')
    while (i > 0) {
      const dir = path.slice(0, i)
      const prev = folders.get(dir)
      if (!prev || RANK[badge.cls] > RANK[prev.cls]) folders.set(dir, badge)
      i = dir.lastIndexOf('/')
    }
  }
  return {
    size: files.size,
    get(relPath) {
      const direct = files.get(relPath)
      if (direct) return direct
      const folder = folders.get(relPath)
      if (folder) return folder
      for (const d of untrackedDirs) if (relPath.startsWith(`${d}/`)) return BADGE.untracked
      return null
    },
    isFolderMark(relPath) {
      return folders.has(relPath) || untrackedDirs.includes(relPath)
    }
  }
}
