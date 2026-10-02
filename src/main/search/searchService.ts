import { MessageChannel, Worker } from 'node:worker_threads'
import type { WebContents } from 'electron'
import type { WatchEvent } from '@shared/ipc'
import type { QuickResults } from '@shared/search/pathIndex'
import indexWorkerPath from './indexWorker?modulePath'
import contentWorkerPath from './contentWorker?modulePath'
import { isTooBroadToIndex } from './indexCore'
import {
  SHARED,
  type ContentOptions,
  type IndexIn,
  type IndexOut,
  type IndexStatus,
  type SearchIn,
  type SearchOut
} from './protocol'
import { buildMatcher } from '@shared/search/lineSearch'
import type { ContentDone, SearchEvent } from '@shared/search/types'

const MAX_INDEXES = 3
const MAX_SCAN_WORKERS = 2
const INDEX_IDLE_MS = 15 * 60_000
const SCAN_IDLE_MS = 60_000
const CANCEL_GRACE_MS = 1500

interface Handle {
  root: string
  worker: Worker
  status: IndexStatus
  lastUsed: number
  subscribers: Set<WebContents>
  pending: Map<number, (r: { results: QuickResults; status: IndexStatus } | null) => void>
  failed: boolean
  idleTimer: ReturnType<typeof setTimeout> | null
}

interface ContentRun {
  id: number
  sender: WebContents
  handle: Handle
  shared: Int32Array
  workers: Worker[]
  doneWorkers: number
  total: number | null
  finished: boolean
  /** The UI was already told it ended (cancel); late worker messages are dropped. */
  muted: boolean
  watchdog: ReturnType<typeof setTimeout> | null
  error?: string
}

const handles = new Map<string, Handle>()
const scanWorkers: Worker[] = []
let scanIdleTimer: ReturnType<typeof setTimeout> | null = null
const runs = new Map<number, ContentRun>()
const runBySender = new Map<number, ContentRun>()
let nextId = 1

const send = (wc: WebContents, ev: SearchEvent): void => {
  if (!wc.isDestroyed()) wc.send('search:event', ev)
}

function disabledStatus(reason: string): IndexStatus {
  return { state: 'disabled', files: 0, dirs: 0, truncated: false, ignoredDone: true, phase: 'ready', walkMs: 0, reason }
}

function touch(h: Handle): void {
  h.lastUsed = Date.now()
  if (h.idleTimer) clearTimeout(h.idleTimer)
  h.idleTimer = setTimeout(() => dropHandle(h.root), INDEX_IDLE_MS)
  h.idleTimer.unref?.()
}

function dropHandle(root: string): void {
  const h = handles.get(root)
  if (!h) return
  handles.delete(root)
  if (h.idleTimer) clearTimeout(h.idleTimer)
  for (const r of h.pending.values()) r(null)
  h.pending.clear()
  void h.worker.terminate()
  for (const run of [...runs.values()]) {
    if (run.handle === h) {
      run.error = run.error ?? 'The search index was closed'
      finishRun(run)
    }
  }
}

function handleFor(root: string, wc: WebContents): Handle | null {
  let h = handles.get(root)
  if (!h) {
    if (isTooBroadToIndex(root)) return null
    while (handles.size >= MAX_INDEXES) {
      let oldest: Handle | null = null
      for (const x of handles.values()) if (!oldest || x.lastUsed < oldest.lastUsed) oldest = x
      if (!oldest) break
      dropHandle(oldest.root)
    }
    const worker = new Worker(indexWorkerPath, { workerData: { root } })
    const handle: Handle = {
      root,
      worker,
      status: { state: 'idle', files: 0, dirs: 0, truncated: false, ignoredDone: false, phase: 'walking', walkMs: 0 },
      lastUsed: Date.now(),
      subscribers: new Set(),
      pending: new Map(),
      failed: false,
      idleTimer: null
    }
    worker.on('message', (m: IndexOut) => onIndexMessage(handle, m))
    worker.on('error', () => {
      handle.failed = true
      handle.status = disabledStatus('The search index stopped unexpectedly')
      for (const r of handle.pending.values()) r(null)
      handle.pending.clear()
    })
    worker.on('exit', () => {
      handle.failed = true
      if (handles.get(root) === handle) handles.delete(root)
    })
    handles.set(root, handle)
    h = handle
  }
  if (h.failed) return null
  if (!h.subscribers.has(wc)) {
    h.subscribers.add(wc)
    wc.once('destroyed', () => h.subscribers.delete(wc))
  }
  touch(h)
  return h
}

function onIndexMessage(h: Handle, m: IndexOut): void {
  switch (m.t) {
    case 'status':
      h.status = m.status
      for (const wc of h.subscribers) send(wc, { kind: 'index', root: h.root, status: m.status })
      break
    case 'queryResult': {
      h.status = m.status
      const r = h.pending.get(m.id)
      h.pending.delete(m.id)
      r?.({ results: m.results, status: m.status })
      break
    }
    case 'queryStale': {
      const r = h.pending.get(m.id)
      h.pending.delete(m.id)
      r?.(null)
      break
    }
    case 'contentStart': {
      const run = runs.get(m.id)
      if (run) {
        run.total = m.total
        send(run.sender, { kind: 'content-start', id: m.id, total: m.total })
      }
      break
    }
    default:
      break
  }
}

export interface QuickRequest {
  query: string
  includeIgnored: boolean
  kinds: 'files' | 'both'
  limit: number
  recent: string[]
  owner: number
}

export type QuickResponse =
  | { kind: 'ok'; results: QuickResults; status: IndexStatus }
  | { kind: 'stale' }
  | { kind: 'unavailable'; status: IndexStatus }

export function quickSearch(root: string, wc: WebContents, req: QuickRequest): Promise<QuickResponse> {
  const h = handleFor(root, wc)
  if (!h) {
    return Promise.resolve({
      kind: 'unavailable',
      status: disabledStatus(
        isTooBroadToIndex(root) ? 'This folder is too broad to index. Open a project folder.' : 'Search index unavailable'
      )
    })
  }
  const id = nextId++
  return new Promise<QuickResponse>((resolve) => {
    h.pending.set(id, (r) => resolve(r ? { kind: 'ok', ...r } : { kind: 'stale' }))
    const msg: IndexIn = {
      t: 'query',
      id,
      owner: req.owner,
      query: req.query,
      includeIgnored: req.includeIgnored,
      kinds: req.kinds,
      limit: req.limit,
      recent: req.recent
    }
    h.worker.postMessage(msg)
  })
}

export function indexStatus(root: string, wc: WebContents): IndexStatus {
  const h = handleFor(root, wc)
  if (!h) {
    return disabledStatus(isTooBroadToIndex(root) ? 'This folder is too broad to index. Open a project folder.' : 'Search index unavailable')
  }
  h.worker.postMessage({ t: 'status' } satisfies IndexIn)
  return h.status
}

export function applyWatch(root: string, events: WatchEvent[]): void {
  const h = handles.get(root)
  if (!h || h.failed) return
  h.worker.postMessage({ t: 'watch', events } satisfies IndexIn)
}

export function refreshIndex(root: string): void {
  const h = handles.get(root)
  if (h && !h.failed) h.worker.postMessage({ t: 'refresh' } satisfies IndexIn)
}

/** Is the index for `root` built far enough that a name search over it is trustworthy? */
export function indexReady(root: string): boolean {
  const h = handles.get(root)
  return !!h && !h.failed && (h.status.phase === 'ignored' || h.status.phase === 'ready')
}

function ensureScanWorkers(): Worker[] {
  if (scanIdleTimer) clearTimeout(scanIdleTimer)
  scanIdleTimer = null
  while (scanWorkers.length < MAX_SCAN_WORKERS) {
    const w = new Worker(contentWorkerPath)
    w.on('message', (m: SearchOut) => onScanMessage(m))
    let dropped = false
    const drop = (): void => {
      if (dropped) return
      dropped = true
      const i = scanWorkers.indexOf(w)
      if (i >= 0) scanWorkers.splice(i, 1)
      for (const run of [...runs.values()]) {
        if (run.workers.includes(w)) {
          run.error = run.error ?? 'A search worker stopped'
          run.doneWorkers++
          if (run.doneWorkers >= run.workers.length) finishRun(run)
        }
      }
    }
    w.on('error', drop)
    w.on('exit', drop)
    scanWorkers.push(w)
  }
  return scanWorkers.slice()
}

function scheduleScanIdle(): void {
  if (runs.size > 0) return
  if (scanIdleTimer) clearTimeout(scanIdleTimer)
  scanIdleTimer = setTimeout(() => {
    scanIdleTimer = null
    if (runs.size > 0) return
    for (const w of scanWorkers.splice(0)) void w.terminate()
  }, SCAN_IDLE_MS)
  scanIdleTimer.unref?.()
}

function onScanMessage(m: SearchOut): void {
  const run = runs.get(m.id)
  if (!run || run.finished) return
  if (m.t === 'progress') {
    if (!run.muted) {
      send(run.sender, {
        kind: 'content-progress',
        id: m.id,
        files: m.files,
        scanned: Atomics.load(run.shared, SHARED.SCANNED)
      })
    }
  } else {
    if (m.error) run.error = m.error
    run.doneWorkers++
    if (run.doneWorkers >= run.workers.length) finishRun(run)
  }
}

function summary(run: ContentRun, canceled: boolean): ContentDone {
  const s = run.shared
  return {
    canceled: canceled || Atomics.load(s, SHARED.CANCEL) === 1,
    error: run.error,
    scanned: Atomics.load(s, SHARED.SCANNED),
    total: run.total ?? 0,
    storedLines: Atomics.load(s, SHARED.STORED),
    totalLines: Atomics.load(s, SHARED.TOTAL_LINES),
    filesWithMatches: Atomics.load(s, SHARED.FILES_WITH_MATCH),
    skippedLarge: Atomics.load(s, SHARED.SKIPPED_LARGE),
    skippedBinary: Atomics.load(s, SHARED.SKIPPED_BINARY),
    errors: Atomics.load(s, SHARED.ERRORS)
  }
}

function finishRun(run: ContentRun): void {
  if (run.finished) return
  const wasMuted = run.muted
  const done = summary(run, false)
  run.finished = true
  if (run.watchdog) clearTimeout(run.watchdog)
  runs.delete(run.id)
  if (runBySender.get(run.sender.id) === run) runBySender.delete(run.sender.id)
  // Releases the feeder if it is still waiting for credits (invalid regex, dead worker).
  Atomics.store(run.shared, SHARED.CANCEL, 1)
  if (!wasMuted) send(run.sender, { kind: 'content-done', id: run.id, ...done })
  scheduleScanIdle()
}

export function cancelContent(wcId: number): void {
  const run = runBySender.get(wcId)
  if (!run || run.finished) return
  runBySender.delete(wcId)
  Atomics.store(run.shared, SHARED.CANCEL, 1)
  run.muted = true
  send(run.sender, { kind: 'content-done', id: run.id, ...summary(run, true) })
  // Normal path: scanners notice the flag between files and report done.
  // A runaway regex cannot notice, so after a grace period the workers are replaced.
  run.watchdog = setTimeout(() => {
    if (run.finished) return
    for (const w of run.workers) {
      const i = scanWorkers.indexOf(w)
      if (i >= 0) scanWorkers.splice(i, 1)
      void w.terminate()
    }
    finishRun(run)
  }, CANCEL_GRACE_MS)
  run.watchdog.unref?.()
}

export function startContent(
  root: string,
  wc: WebContents,
  opts: ContentOptions
): { id: number } | { error: string } {
  cancelContent(wc.id)
  if (!opts.query) return { error: 'Type something to search for' }
  const matcher = buildMatcher(opts)
  if (!matcher.ok) return { error: matcher.error }
  const h = handleFor(root, wc)
  if (!h) return { error: 'Search index unavailable for this folder' }
  const workers = ensureScanWorkers()
  const id = nextId++
  const sab = new SharedArrayBuffer(SHARED.LENGTH * 4)
  const run: ContentRun = {
    id,
    sender: wc,
    handle: h,
    shared: new Int32Array(sab),
    workers,
    doneWorkers: 0,
    total: null,
    finished: false,
    muted: false,
    watchdog: null
  }
  runs.set(id, run)
  runBySender.set(wc.id, run)
  if (!destroyHooked.has(wc.id)) {
    destroyHooked.add(wc.id)
    wc.once('destroyed', () => {
      destroyHooked.delete(wc.id)
      cancelContent(wc.id)
    })
  }

  const feederPorts: import('node:worker_threads').MessagePort[] = []
  for (const w of workers) {
    const ch = new MessageChannel()
    feederPorts.push(ch.port1)
    const attach: SearchIn = { t: 'attach', id, root, opts, port: ch.port2 as never, shared: sab }
    w.postMessage(attach, [ch.port2])
  }
  const msg: IndexIn = { t: 'content', id, opts, ports: feederPorts as never, shared: sab }
  h.worker.postMessage(msg, feederPorts)
  return { id }
}

const destroyHooked = new Set<number>()

export function disposeAllSearch(): void {
  for (const root of [...handles.keys()]) dropHandle(root)
  for (const w of scanWorkers.splice(0)) void w.terminate()
}
