import { watch, type FSWatcher } from 'chokidar'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import type { BrowserWindow } from 'electron'
import { IGNORED_ENTRIES, WATCH_DEBOUNCE_MS, SESSION_CHANGE_LOG_CAP } from '@shared/constants'
import { exceedsWatchBudget, countDirsBounded } from './watchPolicy'
import type { WatchEvent } from '@shared/ipc'

/**
 * Recursively watching an enormous tree (the home directory, a filesystem root)
 * makes chokidar walk millions of paths and freezes the main process. Projects
 * never live at those roots, so we simply don't watch them — the file tree still
 * works on demand; there are just no live change events.
 */
function isTooLargeToWatch(root: string): boolean {
  const r = resolve(root)
  const home = resolve(os.homedir())
  if (r === home) return true
  if (resolve(r, '..') === r) return true // filesystem root (/ or C:\)
  if (home === r || home.startsWith(r + sep)) return true // an ancestor of home (e.g. /Users)
  return false
}

/** Does a path RELATIVE TO THE WATCH ROOT have any segment on the ignore list?
 * A project whose own folder happens to sit inside a directory named e.g.
 * "build" (an ANCESTOR of the root, not a subfolder under it) must not have
 * everything inside it ignored too — only segments at or below the root count.
 * (The previous version tested the absolute path's segments, which broke
 * exactly that case.) */
export function hasIgnoredSegment(root: string, absolutePath: string): boolean {
  const rel = relative(root, absolutePath)
  if (!rel) return false
  const segments = rel.split(sep)
  return IGNORED_ENTRIES.some((entry) => segments.includes(entry))
}

/** One chokidar watcher per window, targeting that window's focused project,
 * plus a small dedicated watcher over just the parts of `.git` that change on
 * a commit/checkout/branch switch (main's own watcher never sees these — `.git`
 * is in IGNORED_ENTRIES so the file tree/watch budget stay cheap). */
interface WindowWatch {
  watcher: FSWatcher
  gitWatcher: FSWatcher | null
  root: string
  batch: WatchEvent[]
  timer: ReturnType<typeof setTimeout> | null
  /** Files changed since the watcher started — backs the review "session"
   * baseline. Kept in `sessionLogs` (below) so it survives a retarget back to
   * a root this window watched earlier in the same session. */
  sessionLog: Set<string>
  win: BrowserWindow
}

const watches = new Map<number, WindowWatch>()

// Retargets are debounced per window so rapid focus/cwd changes coalesce and the
// heavy chokidar setup never runs on the terminal-create critical path.
const RETARGET_DEBOUNCE_MS = 250
const retargetTimers = new Map<number, ReturnType<typeof setTimeout>>()
const pendingRoot = new Map<number, string>()
// Bumped on each retarget so a slow async dir-scan started for an older root can
// detect it's been superseded and not install a stale watcher.
const retargetGen = new Map<number, number>()

// Per-window, per-root session change logs. A -> B -> A within one window used
// to hand the root-A log to the garbage collector the moment B took over, so
// switching back to A during the same session showed an empty "changed" list.
// Capped per window so an afternoon of `cd`-ing around doesn't grow forever.
const MAX_TRACKED_ROOTS_PER_WINDOW = 20
const sessionLogs = new Map<number, Map<string, Set<string>>>()

function sessionLogFor(id: number, root: string): Set<string> {
  let byRoot = sessionLogs.get(id)
  if (!byRoot) {
    byRoot = new Map()
    sessionLogs.set(id, byRoot)
  }
  let log = byRoot.get(root)
  if (!log) {
    log = new Set()
    byRoot.set(root, log)
    if (byRoot.size > MAX_TRACKED_ROOTS_PER_WINDOW) {
      const oldest = byRoot.keys().next().value
      if (oldest !== undefined) byRoot.delete(oldest)
    }
  }
  return log
}

function schedule(id: number): void {
  const w = watches.get(id)
  if (!w || w.timer) return
  w.timer = setTimeout(() => {
    w.timer = null
    if (w.batch.length === 0) return
    const events = w.batch
    w.batch = []
    if (!w.win.isDestroyed()) w.win.webContents.send('fs:watch', { events })
  }, WATCH_DEBOUNCE_MS)
}

function closeWatch(id: number): void {
  const t = retargetTimers.get(id)
  if (t) {
    clearTimeout(t)
    retargetTimers.delete(id)
  }
  pendingRoot.delete(id)
  const w = watches.get(id)
  if (!w) return
  void w.watcher.close()
  if (w.gitWatcher) void w.gitWatcher.close()
  if (w.timer) clearTimeout(w.timer)
  watches.delete(id)
}

/** Point a window's watcher at `projectRoot` — debounced so rapid focus/cwd
 * changes coalesce and the heavy chokidar setup never runs on the terminal
 * create critical path. */
export function retargetWatcher(win: BrowserWindow, projectRoot: string): void {
  const id = win.webContents.id
  const existing = watches.get(id)
  if (existing && existing.root === projectRoot) {
    // Already watching it — cancel any switch-AWAY still pending. Without this,
    // a quick A -> B -> A bounce within the debounce window left the B retarget
    // scheduled, which then fired ~250ms later and incorrectly moved the
    // watcher off A even though the final, settled choice was A all along.
    const prev = retargetTimers.get(id)
    if (prev) {
      clearTimeout(prev)
      retargetTimers.delete(id)
    }
    pendingRoot.delete(id)
    return
  }
  pendingRoot.set(id, projectRoot)
  const prev = retargetTimers.get(id)
  if (prev) clearTimeout(prev)
  retargetTimers.set(
    id,
    setTimeout(() => {
      retargetTimers.delete(id)
      const root = pendingRoot.get(id)
      pendingRoot.delete(id)
      if (root && !win.isDestroyed()) void applyRetarget(win, root)
    }, RETARGET_DEBOUNCE_MS)
  )
}

/** A small, always-cheap watcher over just `.git/HEAD`, `.git/index` and
 * `.git/refs/**` — enough to notice a commit/checkout/branch switch/merge run
 * from the terminal (or another tool) that the main watcher can't see, since
 * `.git` itself is in IGNORED_ENTRIES. Pushed into the SAME batch as the main
 * watcher, so the renderer's existing "any fs:watch event -> refresh git
 * status" handling picks it up for free. */
function startGitWatcher(w: WindowWatch): FSWatcher | null {
  const gitDir = join(w.root, '.git')
  if (!existsSync(gitDir)) return null
  const watcher = watch(gitDir, {
    ignoreInitial: true,
    followSymlinks: false,
    depth: 3,
    ignored: (p: string) => {
      const rel = relative(gitDir, p)
      if (rel === '') return false
      const top = rel.split(/[\\/]/)[0]
      return top !== 'HEAD' && top !== 'index' && top !== 'refs'
    }
  })
  const onChange = (): void => {
    w.batch.push({ type: 'change', relPath: '.git' })
    schedule(w.win.webContents.id)
  }
  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange)
  watcher.on('error', (err: unknown) => {
    console.error('[watcherService] .git watcher error:', err)
  })
  return watcher
}

/** Replace a window's watcher with one rooted at `projectRoot` (the debounced
 * worker behind retargetWatcher). Async + non-blocking: the dir-scan never
 * freezes the main process, and a scan superseded by a newer retarget is dropped. */
async function applyRetarget(win: BrowserWindow, projectRoot: string): Promise<void> {
  const id = win.webContents.id
  const existing = watches.get(id)
  if (existing && existing.root === projectRoot) return
  const gen = (retargetGen.get(id) ?? 0) + 1
  retargetGen.set(id, gen)
  closeWatch(id)

  // Never recursively watch the home dir / a filesystem root, nor a tree larger
  // than the watch budget — either would walk a huge number of paths and stall
  // the app. (The file tree still works; there are just no live change events.)
  if (isTooLargeToWatch(projectRoot)) return
  let count: number
  try {
    count = await countDirsBounded(projectRoot)
  } catch {
    return
  }
  // A newer retarget (or window teardown) happened while we were scanning — abort
  // so we don't install a watcher for a stale root or leak one over a newer one.
  if (win.isDestroyed() || retargetGen.get(id) !== gen) return
  if (exceedsWatchBudget(count)) return

  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    followSymlinks: false,
    depth: 16,
    ignorePermissionErrors: true,
    ignored: (p: string) => hasIgnoredSegment(projectRoot, p)
  })
  const w: WindowWatch = {
    watcher,
    gitWatcher: null,
    root: projectRoot,
    batch: [],
    timer: null,
    sessionLog: sessionLogFor(id, projectRoot),
    win
  }
  watches.set(id, w)
  w.gitWatcher = startGitWatcher(w)

  const handler =
    (type: WatchEvent['type']) =>
    (path: string): void => {
      const relPath = relative(w.root, path).split(sep).join('/')
      if (!relPath) return
      w.batch.push({ type, relPath })
      if (type === 'add' || type === 'change' || type === 'unlink') {
        w.sessionLog.add(relPath)
        if (w.sessionLog.size > SESSION_CHANGE_LOG_CAP) {
          w.sessionLog.delete(w.sessionLog.values().next().value as string)
        }
      }
      schedule(id)
    }

  watcher
    .on('add', handler('add'))
    .on('change', handler('change'))
    .on('unlink', handler('unlink'))
    .on('addDir', handler('addDir'))
    .on('unlinkDir', handler('unlinkDir'))
  watcher.on('error', (err: unknown) => {
    // ENOSPC (too many inotify watches on Linux), EPERM on a locked-down
    // folder, etc. — the watch for this root is degraded, not the whole app;
    // never let an unhandled 'error' crash the main process.
    console.error('[watcherService] watcher error:', err)
  })
}

export function getSessionChanges(webContentsId: number): string[] {
  return [...(watches.get(webContentsId)?.sessionLog ?? [])]
}

export function stopWatchingById(webContentsId: number): void {
  closeWatch(webContentsId)
  // Only a full stop (window closed) forgets this window's per-root history —
  // an in-session retarget must NOT clear retargetGen (applyRetarget just set
  // it and immediately checks it back) or sessionLogs (the whole point of
  // keying them by root is to survive a retarget).
  retargetGen.delete(webContentsId)
  sessionLogs.delete(webContentsId)
}

export function stopAllWatchers(): void {
  for (const id of [...watches.keys()]) stopWatchingById(id)
}
