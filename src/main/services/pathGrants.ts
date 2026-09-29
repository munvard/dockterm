import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { isInside } from './pathJail'

/**
 * Which paths the composer's attachment tray may look at (existence, folder flag,
 * thumbnail). A path is allowed only when the USER supplied it in this session
 * (open dialog, files copied in Finder/Explorer, or a real drop, all recorded here in
 * the main process) or it lies inside a project root the window has had or the
 * DockTerm image temp dir. A renderer cannot probe arbitrary paths, and cannot invent
 * a grant: drops are recorded by the preload script from real File objects.
 */

const MAX_GRANTS_PER_WINDOW = 5000
const grants = new Map<number, Set<string>>()

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return resolve(p)
  }
}

export function grantPaths(webContentsId: number, paths: readonly string[]): void {
  let set = grants.get(webContentsId)
  if (!set) {
    set = new Set()
    grants.set(webContentsId, set)
  }
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 4096) continue
    set.add(resolve(p))
    set.add(real(p))
    while (set.size > MAX_GRANTS_PER_WINDOW) {
      const oldest = set.values().next().value
      if (oldest === undefined) break
      set.delete(oldest)
    }
  }
}

export function clearGrants(webContentsId: number): void {
  grants.delete(webContentsId)
}

/** `dirs`: roots (project roots, the image temp dir) whose contents are always allowed. */
export function isPathAllowed(webContentsId: number, path: string, dirs: readonly string[]): boolean {
  const set = grants.get(webContentsId)
  const abs = resolve(path)
  const canon = real(path)
  if (set && (set.has(abs) || set.has(canon))) return true
  // Compare canonical to canonical, so a symlink inside a root cannot lead outside it.
  return dirs.some((d) => isInside(real(d), canon))
}
