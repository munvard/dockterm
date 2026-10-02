import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { getSettings } from './settingsService'
import { claudeConfigDir } from './claudeConfigDir'
import { readPlanTier } from './usagePlanTier'
import { UsageScanner, type ScanReply, type ScanRequest } from './usageScanner'
import { PLAN, budgetsForTier, buildSnapshot, type PlanBudgets } from './usageCore'
import type { UsageSnapshot } from '@shared/types'
import usageWorkerPath from './usageWorker?modulePath'

/**
 * Live, tokens-only view of local Claude Code usage.
 *
 * Claude Code writes a full JSONL transcript per session under
 * `~/.claude/projects/<slug>/*.jsonl`. Every assistant line carries
 * `message.usage` (input / output / cache-create / cache-read tokens), the
 * model, a timestamp, and the project `cwd`. Because DockTerm runs Claude in its
 * own terminals these files grow live, so a worker thread (usageWorker.ts) tails
 * the appended bytes on a short interval and returns an aggregated snapshot,
 * which is broadcast to the renderer. The main process never reads or parses a
 * transcript. Read-only; only token counts are read, never message content.
 */

const PROJECTS_DIR = join(claudeConfigDir(), 'projects')
const POLL_MS = 5_000
/** First scan waits until the window is on screen, so startup is never delayed by it. */
const FIRST_SCAN_DELAY_MS = 1_500

/** Resolve the budgets to use now: the user's chosen plan, or auto-detected. */
async function currentBudgets(): Promise<PlanBudgets> {
  const sel = getSettings().usage.plan
  if (sel !== 'auto' && sel in PLAN) return PLAN[sel as 'pro' | 'max5x' | 'max20x']
  return budgetsForTier(await readPlanTier())
}

/* --------------------------- live file scanning --------------------------- */

let started = false
let timer: ReturnType<typeof setInterval> | null = null
let firstScanTimer: ReturnType<typeof setTimeout> | null = null
let worker: Worker | null = null
let workerFailed = false
let fallback: UsageScanner | null = null
let reqId = 0
const pending = new Map<number, (r: ScanReply) => void>()
let scanning: Promise<ScanReply> | null = null
let lastSnapshot: UsageSnapshot | null = null

function stopWorker(): void {
  const w = worker
  worker = null
  if (w) void w.terminate()
  for (const done of pending.values()) done({ id: -1, changed: false, snapshot: lastSnapshot ?? buildSnapshot([], Date.now()) })
  pending.clear()
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (workerFailed) return null
  try {
    const w = new Worker(usageWorkerPath, { workerData: { projectsDir: PROJECTS_DIR } })
    w.on('message', (r: ScanReply) => {
      const done = pending.get(r.id)
      pending.delete(r.id)
      done?.(r)
    })
    // A worker that cannot load or dies falls back to scanning in-process, so the
    // usage panel keeps working (at the old cost) instead of going blank.
    w.on('error', () => {
      workerFailed = true
      stopWorker()
    })
    w.on('exit', () => {
      if (worker === w) {
        workerFailed = true
        stopWorker()
      }
    })
    worker = w
    return w
  } catch {
    workerFailed = true
    return null
  }
}

async function scanOnce(): Promise<ScanReply> {
  const budgets = await currentBudgets()
  const w = ensureWorker()
  if (w) {
    const id = ++reqId
    const reply = await new Promise<ScanReply>((resolve) => {
      pending.set(id, resolve)
      w.postMessage({ id, budgets } satisfies ScanRequest)
    })
    if (reply.id !== -1) return reply
    // the worker died while this request was waiting: fall through to in-process
  }
  fallback ??= new UsageScanner(PROJECTS_DIR)
  const changed = await fallback.scan()
  return { id: 0, changed, snapshot: fallback.snapshot(Date.now(), budgets) }
}

function scan(): Promise<ScanReply> {
  if (!scanning) {
    scanning = scanOnce()
      .then((r) => {
        lastSnapshot = r.snapshot
        return r
      })
      .finally(() => {
        scanning = null
      })
  }
  return scanning
}

/** An all-zero snapshot (Usage turned off — nothing read, nothing shown). */
function emptySnapshot(): UsageSnapshot {
  return buildSnapshot([], Date.now())
}

function broadcast(snap: UsageSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('usage:changed', snap)
  }
}

/** Current snapshot, after ensuring at least one (de-duped) scan has run. Returns
 * an empty snapshot (and reads nothing) when the user has turned Usage off. */
export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  if (!getSettings().usage.enabled) return emptySnapshot()
  return (await scan()).snapshot
}

function whenWindowShown(run: () => void): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed() || win.isVisible()) {
    firstScanTimer = setTimeout(run, FIRST_SCAN_DELAY_MS)
    return
  }
  let done = false
  const go = (): void => {
    if (done) return
    done = true
    firstScanTimer = setTimeout(run, FIRST_SCAN_DELAY_MS)
  }
  win.once('ready-to-show', go)
  firstScanTimer = setTimeout(go, 8_000) // never wait forever for a window that does not show
}

/** Start tailing transcripts: first once the window has shown, then every few
 * seconds. Skips entirely while Usage is disabled or reads Claude's own numbers,
 * so nothing is read from disk in the background. */
export function startUsageWatcher(): void {
  if (started) return
  started = true
  const tick = (): void => {
    const u = getSettings().usage
    // With source 'claude' the pill reads Claude's own numbers, so the transcript
    // scan only runs on demand (usage:get, when the Usage panel opens).
    if (!u.enabled || u.source === 'claude') return
    void scan().then((r) => {
      if (r.changed) broadcast(r.snapshot)
    })
  }
  whenWindowShown(() => {
    if (!started) return
    tick()
    timer = setInterval(tick, POLL_MS)
  })
}

export function stopUsageWatcher(): void {
  if (firstScanTimer) clearTimeout(firstScanTimer)
  firstScanTimer = null
  if (timer) clearInterval(timer)
  timer = null
  stopWorker()
  started = false
}
