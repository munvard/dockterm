import { BrowserWindow, Notification, powerSaveBlocker } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, stat, open } from 'node:fs/promises'
import { getSettings } from './settingsService'
import { parseAgentLine, reduceActivity, type AgentEvent } from './agentParse'
import type { AgentActivity } from '@shared/types'

/**
 * Live view of Claude Code sub-agents, reconstructed read-only from the same local
 * transcripts the usage panel reads (`~/.claude/projects/<slug>/<session>.jsonl`).
 * We tail appended bytes, parse only `Agent`/`Task` spawns + their `tool_result`
 * completions (see agentParse), keep a small rolling set of events, and broadcast
 * an aggregated snapshot to every window. Nothing is written or executed.
 *
 * Because finished agents are dropped from the snapshot shortly after they end,
 * the only agents ever surfaced are the ones running right now plus the ones that
 * just finished — so reading the recent tail of active sessions is enough.
 */

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const RETAIN_MS = 30_000 // keep a finished agent in the snapshot this long (celebrate)
const RESULT_MAX = 280
const EVENT_TTL_MS = 60 * 60_000 // forget raw events older than an hour (memory bound)
const TAIL_BYTES = 512 * 1024 // on first sight of an active file, only parse its recent tail
const FRESH_MS = 5 * 60_000 // a session counts as "active" if touched this recently
const ACTIVE_POLL_MS = 1_000 // snappy while agents are running
const IDLE_POLL_MS = 4_000

let events: AgentEvent[] = []
const offsets = new Map<string, number>()
const firstSeen = new Set<string>() // files whose tail start needs its partial head trimmed
let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let scanning: Promise<boolean> | null = null
let lastActiveCount = 0
let blockerId: number | null = null

function enabled(): boolean {
  return getSettings().agentActivity.enabled
}

async function readSlice(path: string, start: number, end: number): Promise<string> {
  const len = end - start
  if (len <= 0) return ''
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, start)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

async function listTranscripts(): Promise<string[]> {
  let dirs: string[]
  try {
    dirs = await readdir(PROJECTS_DIR)
  } catch {
    return []
  }
  const out: string[] = []
  for (const d of dirs) {
    const dir = join(PROJECTS_DIR, d)
    try {
      const files = await readdir(dir)
      for (const f of files) if (f.endsWith('.jsonl')) out.push(join(dir, f))
    } catch {
      // not a directory / unreadable — skip
    }
  }
  return out
}

/** Tail new bytes from changed transcripts, parsing agent spawn/result events. */
async function scanOnce(): Promise<boolean> {
  const files = await listTranscripts()
  let changed = false
  const now = Date.now()
  for (const path of files) {
    let size: number
    let mtimeMs: number
    try {
      const st = await stat(path)
      size = st.size
      mtimeMs = st.mtimeMs
    } catch {
      continue
    }
    if (!offsets.has(path)) {
      // First sight: only tail-read sessions that are currently active — an old,
      // untouched transcript can only hold long-finished agents (which the
      // snapshot drops anyway), so skip straight to its end and read nothing.
      const active = now - mtimeMs < FRESH_MS
      const start = active ? Math.max(0, size - TAIL_BYTES) : size
      offsets.set(path, start)
      if (active && start > 0) firstSeen.add(path)
    }
    let prev = offsets.get(path) ?? 0
    if (size < prev) {
      offsets.set(path, 0) // rotated / truncated → re-read from a fresh tail
      prev = 0
    }
    if (size <= prev) continue
    let text: string
    try {
      text = await readSlice(path, prev, size)
    } catch {
      continue
    }
    // On a first tail read, drop the (probably partial) first line.
    if (firstSeen.delete(path)) {
      const nl = text.indexOf('\n')
      if (nl >= 0) {
        prev += Buffer.byteLength(text.slice(0, nl + 1), 'utf8')
        text = text.slice(nl + 1)
      }
    }
    const lastNl = text.lastIndexOf('\n')
    if (lastNl < 0) continue // no complete line yet
    const complete = text.slice(0, lastNl)
    offsets.set(path, prev + Buffer.byteLength(complete, 'utf8') + 1)
    for (const line of complete.split('\n')) {
      const evs = parseAgentLine(line)
      for (const e of evs) {
        events.push(e)
        changed = true
      }
    }
  }
  if (changed) {
    const cutoff = Date.now() - EVENT_TTL_MS
    events = events.filter((e) => e.ts === 0 || e.ts >= cutoff)
  }
  return changed
}

function scan(): Promise<boolean> {
  if (!scanning) {
    scanning = scanOnce().finally(() => {
      scanning = null
    })
  }
  return scanning
}

function emptySnapshot(now = Date.now()): AgentActivity {
  return { updatedAt: now, agents: [], activeCount: 0, byProject: [] }
}

function buildSnapshot(now = Date.now()): AgentActivity {
  if (!enabled()) return emptySnapshot(now)
  return reduceActivity(events, now, {
    streamOutput: getSettings().agentActivity.streamOutput,
    retainMs: RETAIN_MS,
    resultMax: RESULT_MAX
  })
}

function broadcast(snap: AgentActivity): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('activity:changed', snap)
  }
}

/** Keep the machine awake while agents are running (reuses the munu pattern). */
function applyKeepAwake(active: number): void {
  const want = active > 0 && getSettings().munu.keepAwake
  if (want && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!want && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

/** Soft notify when the last running agent finishes and the app isn't focused. */
function maybeNotify(active: number): void {
  const s = getSettings().agentActivity
  const becameIdle = lastActiveCount > 0 && active === 0
  if (becameIdle && s.notifications && Notification.isSupported()) {
    const appFocused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    if (!appFocused) {
      new Notification({ title: 'DockTerm', body: 'Agents finished', silent: !s.sounds }).show()
    }
  }
  lastActiveCount = active
}

function tick(): void {
  if (!enabled()) {
    applyKeepAwake(0)
    lastActiveCount = 0
    schedule(false)
    return
  }
  void scan()
    .then((c) => {
      const snap = buildSnapshot()
      // Broadcast on any change AND on every tick while agents are running, so a
      // single missed/raced broadcast can't leave the pill or swarm stale — the
      // next tick (≤1s) re-syncs every window.
      if (c || snap.activeCount > 0) broadcast(snap)
      applyKeepAwake(snap.activeCount)
      maybeNotify(snap.activeCount)
      schedule(snap.activeCount > 0)
    })
    .catch(() => {
      // A transient file error must never kill the watcher — always reschedule.
      schedule(false)
    })
}

function schedule(active: boolean): void {
  if (!started) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, active ? ACTIVE_POLL_MS : IDLE_POLL_MS)
}

/** Current snapshot, after ensuring a scan has run (used by the `agents:get` handler). */
export async function getAgentActivity(): Promise<AgentActivity> {
  if (!enabled()) return emptySnapshot()
  await scan()
  return buildSnapshot()
}

/** Start tailing transcripts for agent activity (idempotent). */
export function startAgentWatcher(): void {
  if (started) return
  started = true
  tick()
}

export function stopAgentWatcher(): void {
  if (timer) clearTimeout(timer)
  timer = null
  started = false
  if (blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}
