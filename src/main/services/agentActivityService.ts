import { BrowserWindow, Notification, powerSaveBlocker } from 'electron'
import { join } from 'node:path'
import { getSettings } from './settingsService'
import { activityKeys, createAgentTracker } from './agentTracker'
import { claudeConfigDir } from './claudeConfigDir'
import { createPidOwner, paneWork, processTableReader } from './agentPanes'
import { ptyProcesses } from './ptyService'
import type { AgentActivity } from '@shared/types'

/**
 * Live view of Claude Code agents (foreground sub-agents, background agents and
 * team members), reconstructed read-only from Claude Code's own local files.
 * The reading and reducing lives in agentTracker / agentParse (electron free, so
 * it is unit-tested and replayable); this file only owns the timer, the broadcast
 * to windows, keep-awake and the "agents finished" notification.
 */

const RETAIN_MS = 30_000 // keep a finished agent in the snapshot this long (celebrate)
const RESULT_MAX = 280
const ACTIVE_POLL_MS = 1_000 // snappy while agents are running
const WATCH_POLL_MS = 3_000 // sessions are open but nothing is running
const IDLE_POLL_MS = 8_000 // nothing to follow at all
const DETAIL_GAP_MS = 3_000 // steps/action of running agents are re-sent at most this often

const tracker = createAgentTracker({
  projectsDir: join(claudeConfigDir(), 'projects'),
  sessionsDir: join(claudeConfigDir(), 'sessions')
})

// PowerShell's process query costs about a second on Windows; ps is cheap.
const pidOwner = createPidOwner(processTableReader(), ptyProcesses, process.platform === 'win32' ? 15_000 : 2_000)

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastActiveCount = 0
let lastUnattributed = 0
let lastOutside = 0
let lastAgentsSent = ''
let blockerId: number | null = null
let lastStructure = ''
let lastDetail = ''
let lastSentAt = 0
/** the newest snapshot built by the watcher: activity:get answers from it */
let lastSnap: AgentActivity | null = null
const countListeners = new Set<() => void>()

function enabled(): boolean {
  return getSettings().agentActivity.enabled
}

function emptySnapshot(now = Date.now()): AgentActivity {
  return { updatedAt: now, agents: [], activeCount: 0, byProject: [] }
}

async function scanAll(): Promise<void> {
  await tracker.scan()
  // Not awaited: on Windows the process-table read is a PowerShell child taking
  // about a second. Sessions it has not placed yet count as unplaced; when it has
  // news, the next tick runs at once.
  void pidOwner.refresh(tracker.liveSessions().map((s) => s.pid)).then((learned) => {
    if (learned) schedule(0)
  })
}

function buildSnapshot(): AgentActivity {
  if (!enabled()) return emptySnapshot()
  const snap = tracker.snapshot({
    streamOutput: getSettings().agentActivity.streamOutput,
    retainMs: RETAIN_MS,
    resultMax: RESULT_MAX
  })
  const work = paneWork(tracker.liveSessions(), pidOwner.owner, snap.agents)
  lastUnattributed = work.unattributedRunning
  lastOutside = work.outsideRunning
  return { ...snap, busyPtys: work.busyPtys }
}

/** Agents running right now (keep-awake and the "agents finished" notification). */
export function getActiveAgentCount(): number {
  return lastActiveCount
}

/** Running agents of Claude sessions not matched to a pane: `unplaced` (not placed
 * yet) and `outside` (Claude running outside DockTerm). Matched ones make their own
 * pane busy instead. */
export function getUnattributedAgentCounts(): { unplaced: number; outside: number } {
  return { unplaced: lastUnattributed, outside: lastOutside }
}

/** Called when the number of running agents changes. */
export function onAgentCountChange(cb: () => void): () => void {
  countListeners.add(cb)
  return () => countListeners.delete(cb)
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
function noteCount(active: number): void {
  const s = getSettings().agentActivity
  const prev = lastActiveCount
  const agentsKey = `${lastUnattributed}/${lastOutside}`
  const agentsChanged = agentsKey !== lastAgentsSent
  lastAgentsSent = agentsKey
  if (prev > 0 && active === 0 && s.notifications && Notification.isSupported()) {
    const appFocused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    if (!appFocused) {
      new Notification({ title: 'DockTerm', body: 'Agents finished', silent: !s.sounds }).show()
    }
  }
  lastActiveCount = active
  if (prev !== active || agentsChanged) for (const cb of countListeners) cb()
}

/** Send a snapshot only when something a window renders changed: structure at
 * once, steps/action of running agents at most every DETAIL_GAP_MS (a later tick
 * sends what was held back). The UI ticks elapsed time itself. */
function maybeBroadcast(snap: AgentActivity): void {
  const { structure, detail } = activityKeys(snap)
  const now = Date.now()
  if (structure === lastStructure && (detail === lastDetail || now - lastSentAt < DETAIL_GAP_MS)) return
  lastStructure = structure
  lastDetail = detail
  lastSentAt = now
  broadcast(snap)
}

/** A Claude in a pane (or not yet placed) is mid-turn: poll fast so the pane's
 * busy flag is current when its screen goes quiet. */
function anyBusySession(): boolean {
  return tracker.liveSessions().some((s) => s.status === 'busy' && pidOwner.owner(s.pid) !== null)
}

function tick(): void {
  if (!enabled()) {
    lastUnattributed = lastOutside = 0
    lastSnap = null
    applyKeepAwake(0)
    noteCount(0)
    schedule(IDLE_POLL_MS)
    return
  }
  void scanAll()
    .then(() => {
      const snap = buildSnapshot()
      lastSnap = snap
      // A window that (re)loads pulls the snapshot through activity:get, so
      // nothing relies on a periodic resend.
      maybeBroadcast(snap)
      applyKeepAwake(snap.activeCount)
      noteCount(snap.activeCount)
      schedule(
        snap.activeCount > 0 || anyBusySession()
          ? ACTIVE_POLL_MS
          : tracker.sessionCount() > 0
            ? WATCH_POLL_MS
            : IDLE_POLL_MS
      )
    })
    .catch(() => {
      // A transient file error must never kill the watcher: always reschedule.
      schedule(WATCH_POLL_MS)
    })
}

function schedule(ms: number): void {
  if (!started) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(tick, ms)
}

/** The current snapshot (the `activity:get` handler). While the watcher runs this
 * is the one its last tick built, so a window opening costs no scan. */
export async function getAgentActivity(): Promise<AgentActivity> {
  if (!enabled()) return emptySnapshot()
  if (started && lastSnap) return lastSnap
  await scanAll()
  lastSnap = buildSnapshot()
  return lastSnap
}

/** Start following agent activity (idempotent). */
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
