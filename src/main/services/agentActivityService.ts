import { BrowserWindow, Notification, powerSaveBlocker } from 'electron'
import { join } from 'node:path'
import { getSettings } from './settingsService'
import { createAgentTracker } from './agentTracker'
import { claudeConfigDir } from './claudeConfigDir'
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

const tracker = createAgentTracker({
  projectsDir: join(claudeConfigDir(), 'projects'),
  sessionsDir: join(claudeConfigDir(), 'sessions')
})

let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastActiveCount = 0
let blockerId: number | null = null
let lastSent = ''
const countListeners = new Set<() => void>()

function enabled(): boolean {
  return getSettings().agentActivity.enabled
}

function emptySnapshot(now = Date.now()): AgentActivity {
  return { updatedAt: now, agents: [], activeCount: 0, byProject: [] }
}

function buildSnapshot(): AgentActivity {
  if (!enabled()) return emptySnapshot()
  return tracker.snapshot({
    streamOutput: getSettings().agentActivity.streamOutput,
    retainMs: RETAIN_MS,
    resultMax: RESULT_MAX
  })
}

/** Agents running right now (munu counts them as "still working"). */
export function getActiveAgentCount(): number {
  return lastActiveCount
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
  if (prev > 0 && active === 0 && s.notifications && Notification.isSupported()) {
    const appFocused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    if (!appFocused) {
      new Notification({ title: 'DockTerm', body: 'Agents finished', silent: !s.sounds }).show()
    }
  }
  lastActiveCount = active
  if (prev !== active) for (const cb of countListeners) cb()
}

/** Cheap fingerprint so an unchanged snapshot is not re-sent every second. */
function fingerprint(s: AgentActivity): string {
  return s.agents
    .map((a) => `${a.id}|${a.phase}|${a.steps}|${a.action ?? ''}|${a.resultPreview ?? ''}`)
    .join('\n')
}

function tick(): void {
  if (!enabled()) {
    applyKeepAwake(0)
    noteCount(0)
    schedule(IDLE_POLL_MS)
    return
  }
  void tracker
    .scan()
    .then(() => {
      const snap = buildSnapshot()
      const fp = fingerprint(snap)
      // Re-send on any change, and once a second while agents run (elapsed time is
      // computed in the UI, but a single missed send must not leave a window stale).
      if (fp !== lastSent || snap.activeCount > 0) {
        lastSent = fp
        broadcast(snap)
      }
      applyKeepAwake(snap.activeCount)
      noteCount(snap.activeCount)
      schedule(snap.activeCount > 0 ? ACTIVE_POLL_MS : tracker.sessionCount() > 0 ? WATCH_POLL_MS : IDLE_POLL_MS)
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

/** Current snapshot, after ensuring a scan has run (used by the `activity:get` handler). */
export async function getAgentActivity(): Promise<AgentActivity> {
  if (!enabled()) return emptySnapshot()
  await tracker.scan()
  return buildSnapshot()
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
