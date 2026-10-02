import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { IGNORED_ENTRIES } from '@shared/constants'
import type { WatchEvent } from '@shared/ipc'
import { compileGlobs } from '@shared/search/glob'
import { isSafeRelPath } from '@shared/search/relPath'
import { isIgnoredBy, parseGitignore, type IgnoreScope } from '@shared/search/gitignore'
import { F_DIR, F_GIT, F_IGNORED, PathIndex, DEFAULT_MAX_ENTRIES, type QuickOptions, type QuickResults } from '@shared/search/pathIndex'
import type { ContentOptions, IndexPhase, IndexStatus } from './protocol'

const CONCURRENCY = 8
const BASELINE_IGNORED = new Set(IGNORED_ENTRIES)
const MAX_GITIGNORE_BYTES = 256 * 1024
const WATCH_REFRESH_THRESHOLD = 1500
const STATUS_THROTTLE_MS = 250

interface DirItem {
  rel: string
  scopes: IgnoreScope[]
  ignored: boolean
  git: boolean
}

/** Roots that must never be indexed: the home folder, its parents, a drive root. */
export function isTooBroadToIndex(root: string, platform: string = process.platform): boolean {
  // Windows paths compare without regard to case ("c:\\users\\me" is "C:\\Users\\me").
  const fold = (p: string): string => (platform === 'win32' ? p.toLowerCase() : p)
  const r = fold(resolve(root))
  const home = fold(resolve(homedir()))
  if (r === home) return true
  if (fold(resolve(root, '..')) === r) return true
  if (home.startsWith(r + sep)) return true
  return false
}

/**
 * Owns the file index of one project root. Pure Node (no Electron, no worker
 * APIs) so vitest and the benchmark script drive it directly; indexWorker.ts is a
 * thin message shell around it. Walks the tree asynchronously (a few readdirs in
 * flight, never a long synchronous stretch), in three phases so results are useful
 * early: normal files first, then ignored folders, then .git.
 */
export class IndexerCore {
  private index: PathIndex
  private gen = 0
  private phase: IndexPhase = 'walking'
  private started = false
  private walkMs = 0
  private ignoredDone = false
  private rescanning = false
  private pendingWatch: WatchEvent[] = []
  private gitignores = new Map<string, IgnoreScope>()
  private statusTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private walkDone: Promise<void> = Promise.resolve()

  constructor(
    readonly root: string,
    private readonly onStatus: (s: IndexStatus) => void,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES
  ) {
    this.index = new PathIndex(maxEntries)
  }

  status(): IndexStatus {
    return {
      state: !this.started ? 'idle' : this.phase === 'ready' ? 'ready' : 'indexing',
      files: this.index.files,
      dirs: this.index.dirs,
      truncated: this.index.truncated,
      ignoredDone: this.ignoredDone,
      phase: this.phase,
      walkMs: this.walkMs
    }
  }

  /** Begin the first walk (idempotent). Resolves when the whole walk is done. */
  start(): Promise<void> {
    if (!this.started) {
      this.started = true
      this.walkDone = this.walk(this.index, true)
    }
    return this.walkDone
  }

  whenIdle(): Promise<void> {
    return this.walkDone
  }

  /** Resolve once the tier a search needs is indexed (main files, or also ignored ones). */
  async waitReady(needIgnored: boolean, isCanceled: () => boolean): Promise<void> {
    void this.start()
    for (;;) {
      if (isCanceled()) return
      const ok = needIgnored ? this.phase === 'ready' : this.phase === 'ignored' || this.phase === 'ready'
      if (ok || this.index.truncated) return
      await new Promise<void>((r) => setTimeout(r, 40))
    }
  }

  query(q: string, opts: QuickOptions): { results: QuickResults; status: IndexStatus } {
    void this.start()
    return { results: this.index.query(q, opts), status: this.status() }
  }

  /** Candidate files for a content search, in index (breadth first) order. */
  contentCandidates(opts: Pick<ContentOptions, 'include' | 'exclude' | 'includeIgnored'>): string[] {
    const include = compileGlobs(opts.include)
    const exclude = compileGlobs(opts.exclude)
    const out: string[] = []
    this.index.forEach(opts.includeIgnored, true, (rel) => {
      if (include && !include.test(rel)) return
      if (exclude && exclude.test(rel)) return
      out.push(rel)
    })
    return out
  }

  /** Re-walk into a fresh index and swap it in when finished. */
  refresh(): Promise<void> {
    if (!this.started) return this.start()
    if (this.rescanning) return this.walkDone
    this.rescanning = true
    const next = new PathIndex(this.maxEntries)
    this.walkDone = this.walk(next, false).finally(() => {
      this.rescanning = false
      const queued = this.pendingWatch
      this.pendingWatch = []
      if (queued.length) this.applyWatch(queued)
    })
    return this.walkDone
  }

  applyWatch(events: WatchEvent[]): void {
    if (!this.started) return
    if (this.rescanning) {
      this.pendingWatch.push(...events)
      if (this.pendingWatch.length > 20_000) this.pendingWatch.length = 20_000
      return
    }
    if (events.length > WATCH_REFRESH_THRESHOLD) {
      this.scheduleRefresh()
      return
    }
    for (const e of events) {
      if (!isSafeRelPath(e.relPath)) continue
      const rel = e.relPath.replace(/\\/g, '/')
      if (!rel || rel === '.git' || rel.startsWith('.git/')) continue
      if (rel.endsWith('/.gitignore') || rel === '.gitignore') {
        if (e.type === 'add' || e.type === 'change' || e.type === 'unlink') this.scheduleRefresh()
        continue
      }
      switch (e.type) {
        case 'add':
          this.index.add(rel, this.flagsFor(rel, false))
          break
        case 'addDir': {
          this.index.add(rel, this.flagsFor(rel, true))
          void this.walkSubtree(rel)
          break
        }
        case 'unlink':
          this.index.remove(rel)
          break
        case 'unlinkDir':
          this.index.removeTree(rel)
          break
        default:
          break
      }
    }
    this.emitStatus()
  }

  dispose(): void {
    this.gen++
    if (this.statusTimer) clearTimeout(this.statusTimer)
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, 1000)
  }

  private scopesFor(rel: string): IgnoreScope[] {
    const scopes: IgnoreScope[] = []
    const root = this.gitignores.get('')
    if (root) scopes.push(root)
    const parts = rel.split('/')
    let dir = ''
    for (let i = 0; i < parts.length - 1; i++) {
      dir = dir ? `${dir}/${parts[i]}` : parts[i]
      const s = this.gitignores.get(dir)
      if (s) scopes.push(s)
    }
    return scopes
  }

  private flagsFor(rel: string, isDir: boolean): number {
    let f = isDir ? F_DIR : 0
    const parts = rel.split('/')
    for (const p of parts) {
      if (p === '.git') {
        f |= F_GIT | F_IGNORED
        break
      }
      if (BASELINE_IGNORED.has(p)) {
        f |= F_IGNORED
        break
      }
    }
    if (!(f & F_IGNORED) && isIgnoredBy(this.scopesFor(rel), rel, isDir)) f |= F_IGNORED
    return f
  }

  private emitStatus(force = false): void {
    if (force) {
      if (this.statusTimer) clearTimeout(this.statusTimer)
      this.statusTimer = null
      this.onStatus(this.status())
      return
    }
    if (this.statusTimer) return
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      this.onStatus(this.status())
    }, STATUS_THROTTLE_MS)
  }

  private async walk(target: PathIndex, initial: boolean): Promise<void> {
    const gen = ++this.gen
    const t0 = Date.now()
    const deferredIgnored: DirItem[] = []
    const deferredGit: DirItem[] = []
    if (initial) this.phase = 'walking'
    this.gitignores = new Map()

    const queue: DirItem[] = [{ rel: '', scopes: [], ignored: false, git: false }]
    await this.run(queue, target, gen, (item) => (item.git ? deferredGit.push(item) : deferredIgnored.push(item)))
    if (gen !== this.gen) return
    if (initial) {
      this.phase = 'ignored'
      this.walkMs = Date.now() - t0
      this.emitStatus(true)
    }
    if (!target.truncated) {
      await this.run(deferredIgnored, target, gen, (item) => deferredIgnored.push(item))
    }
    if (gen !== this.gen) return
    if (!target.truncated) {
      await this.run(deferredGit, target, gen, (item) => deferredGit.push(item))
    }
    if (gen !== this.gen) return
    if (!initial) this.index = target
    this.phase = 'ready'
    this.ignoredDone = true
    this.walkMs = Date.now() - t0
    this.emitStatus(true)
  }

  /** Walk a newly added folder (from a watch event) into the live index. */
  private async walkSubtree(rel: string): Promise<void> {
    const flags = this.flagsFor(rel, true)
    const queue: DirItem[] = [
      { rel, scopes: this.scopesFor(`${rel}/x`), ignored: (flags & F_IGNORED) !== 0, git: (flags & F_GIT) !== 0 }
    ]
    const gen = this.gen
    await this.run(queue, this.index, gen, (item) => queue.push(item), true)
    this.emitStatus()
  }

  private async run(
    queue: DirItem[],
    target: PathIndex,
    gen: number,
    defer: (item: DirItem) => void,
    includeIgnoredDirs = false
  ): Promise<void> {
    let head = 0
    let active = 0
    await new Promise<void>((resolveRun) => {
      const finishIfDone = (): void => {
        if (active === 0 && (head >= queue.length || gen !== this.gen || target.truncated)) resolveRun()
      }
      const launch = (): void => {
        while (active < CONCURRENCY && head < queue.length && gen === this.gen && !target.truncated) {
          const item = queue[head]
          ;(queue as Array<DirItem | undefined>)[head] = undefined
          head++
          active++
          this.readDir(item, target, queue, defer, includeIgnoredDirs)
            .catch(() => undefined)
            .finally(() => {
              active--
              launch()
              finishIfDone()
            })
        }
        finishIfDone()
      }
      launch()
    })
  }

  private async readDir(
    item: DirItem,
    target: PathIndex,
    queue: DirItem[],
    defer: (item: DirItem) => void,
    includeIgnoredDirs: boolean
  ): Promise<void> {
    const abs = item.rel ? join(this.root, item.rel) : this.root
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    let scopes = item.scopes
    if (!item.ignored && entries.some((e) => e.name === '.gitignore' && e.isFile())) {
      try {
        const handle = await fs.open(join(abs, '.gitignore'), 'r')
        try {
          const st = await handle.stat()
          if (st.size <= MAX_GITIGNORE_BYTES) {
            const text = await handle.readFile('utf8')
            const scope: IgnoreScope = { base: item.rel, rules: parseGitignore(text) }
            this.gitignores.set(item.rel, scope)
            scopes = [...scopes, scope]
          }
        } finally {
          await handle.close()
        }
      } catch {
        // unreadable .gitignore: carry on without it
      }
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const isDir = entry.isDirectory()
      if (!isDir && !entry.isFile()) continue
      const name = entry.name
      const rel = item.rel ? `${item.rel}/${name}` : name
      let flags = isDir ? F_DIR : 0
      let git = item.git
      let ignored = item.ignored
      if (name === '.git') {
        git = true
        ignored = true
      }
      if (!ignored && BASELINE_IGNORED.has(name)) ignored = true
      if (!ignored && scopes.length && isIgnoredBy(scopes, rel, isDir)) ignored = true
      if (ignored) flags |= F_IGNORED
      if (git) flags |= F_GIT | F_IGNORED
      if (!target.add(rel, flags)) return
      if (isDir) {
        const child: DirItem = { rel, scopes, ignored, git }
        if ((ignored || git) && !includeIgnoredDirs && !item.ignored) defer(child)
        else queue.push(child)
      }
    }
    this.emitStatus()
  }
}
