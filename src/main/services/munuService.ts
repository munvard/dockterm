import { BrowserWindow, Notification, powerSaveBlocker, screen, webContents } from 'electron'
import { aggregate } from '@shared/munu'
import { getSettings } from './settingsService'
import {
  createOverlayWindow,
  destroyOverlay,
  getOverlay,
  repositionOverlay,
  resizeOverlay,
  setOverlayFocusable,
  setOverlayInteractive as setOverlayClickThrough
} from '../overlayWindow'
import { wantReveal } from './munuReveal'
import type { MunuAsk, MunuGlobal, MunuState } from '@shared/types'

/** Per-window aggregate, keyed by webContents id. */
const windowStates = new Map<number, MunuGlobal>()
let blockerId: number | null = null
let lastNotified: MunuState = 'idle'

// Dynamic-Island reveal: munu hides (tucked in the notch) and reveals when the
// cursor enters the top-center zone or briefly after a state change ("peek").
let pollTimer: ReturnType<typeof setInterval> | null = null
let peekUntil = 0
let revealed = false
let lastGlobalState: MunuState = 'idle'

function inRevealZone(): boolean {
  const d = screen.getPrimaryDisplay()
  const p = screen.getCursorScreenPoint()
  const cx = d.bounds.x + d.bounds.width / 2
  // Top-center strip covering the notch + where munu slides down to.
  return Math.abs(p.x - cx) <= 175 && p.y >= d.bounds.y && p.y <= d.bounds.y + 120
}

function pollReveal(): void {
  const overlay = getOverlay()
  if (!overlay) return
  // The window is always present + always-on-top on every Space (set up once at
  // creation); revealing is pure CSS. Keep munu revealed while there's an ask the
  // user CAN'T currently see (its pane is on a background tab/window). When the
  // asking pane is on-screen we don't force it down — a brief peek + sound on the
  // state change is enough.
  const hasUnseenAsk = [...windowStates.values()].some((g) =>
    g.asks.some((a) => !a.visible)
  )
  const want = wantReveal({
    pinned: getSettings().munu.pinned,
    cursorInZone: inRevealZone(),
    hasUnseenAsk,
    peekActive: Date.now() < peekUntil
  })
  if (want !== revealed) {
    revealed = want
    overlay.webContents.send('munu:reveal', want)
  }
}

function startCursorPoll(): void {
  if (pollTimer) return
  peekUntil = Date.now() + 4000 // greet on launch, then tuck away
  revealed = false
  pollTimer = setInterval(pollReveal, 140)
}

function stopCursorPoll(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  revealed = false
}

export function reportMunu(wcId: number, payload: MunuGlobal): void {
  windowStates.set(wcId, payload)
  pushGlobal()
}

export function dropWindowMunu(wcId: number): void {
  if (windowStates.delete(wcId)) pushGlobal()
}

function computeGlobal(): MunuGlobal {
  const states: MunuState[] = []
  const asks: MunuAsk[] = []
  for (const g of windowStates.values()) {
    states.push(g.state)
    for (const a of g.asks) asks.push(a)
  }
  return { state: aggregate(states), asks }
}

function pushGlobal(): void {
  const global = computeGlobal()
  const overlay = getOverlay()
  if (overlay) overlay.webContents.send('munu:state', global)
  // Peek (briefly reveal) when the state changes, so a glance catches it.
  if (global.state !== lastGlobalState) {
    peekUntil = Date.now() + (global.state === 'asking' ? 6000 : 4500)
    lastGlobalState = global.state
  }
  applyKeepAwake(global.state)
  maybeNotify(global.state)
}

/** The window + first asking pane (used to route focus). Prefers an ask the
 * user can't currently see — that's the one the overlay surfaces. */
function ownerOfPrimaryAsk(): { wc: Electron.WebContents; ask: MunuAsk } | null {
  let fallback: { wc: Electron.WebContents; ask: MunuAsk } | null = null
  for (const [wcId, g] of windowStates) {
    const ask = g.asks.find((a) => !a.visible) ?? g.asks[0]
    if (g.state === 'asking' && ask) {
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) {
        const hit = { wc, ask }
        if (!ask.visible) return hit
        fallback ??= hit
      }
    }
  }
  return fallback
}

/** The window owning a specific asking pane (used to route answers exactly). */
function ownerByLeaf(leafId: string): Electron.WebContents | null {
  for (const [wcId, g] of windowStates) {
    if (g.asks.some((a) => a.leafId === leafId)) {
      const wc = webContents.fromId(wcId)
      if (wc && !wc.isDestroyed()) return wc
    }
  }
  return null
}

/** Forward the overlay's synthesized key chunks to the pane that's asking; the
 * renderer writes them into the PTY one at a time, paced. */
export function answerMunu(leafId: string, keys: string[]): void {
  const wc = ownerByLeaf(leafId)
  if (wc) wc.send('munu:doAnswer', { leafId, keys })
}

export function resizeMunu(width: number, height: number): void {
  resizeOverlay(width, height)
}

export function focusMunu(): void {
  const o = ownerOfPrimaryAsk()
  if (!o) return
  const win = BrowserWindow.fromWebContents(o.wc)
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  o.wc.send('munu:doFocus', { tabId: o.ask.tabId, leafId: o.ask.leafId })
}

export function setMunuInteractive(interactive: boolean): void {
  setOverlayClickThrough(interactive)
}

export function setMunuFocusable(focusable: boolean): void {
  setOverlayFocusable(focusable)
}

function applyKeepAwake(state: MunuState): void {
  const want = getSettings().munu.keepAwake && state === 'working'
  if (want && blockerId === null) {
    blockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!want && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function maybeNotify(state: MunuState): void {
  if (!getSettings().munu.notifications || !Notification.isSupported()) {
    lastNotified = state
    return
  }
  const appFocused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
  if (appFocused) {
    lastNotified = state
    return
  }
  if ((state === 'asking' || state === 'done') && state !== lastNotified) {
    new Notification({
      title: 'DockTerm',
      body: state === 'asking' ? 'Claude needs your approval' : 'Claude finished',
      silent: !getSettings().munu.sounds
    }).show()
  }
  lastNotified = state
}

/** Bring DockTerm's real window(s) to the front — used when munu is clicked.
 * Excludes the overlay itself (which is never focusable). */
export function showMainWindows(): void {
  const ov = getOverlay()
  const wins = BrowserWindow.getAllWindows().filter((w) => w !== ov && !w.isDestroyed())
  for (const w of wins) {
    if (w.isMinimized()) w.restore()
    w.show()
  }
  wins[wins.length - 1]?.focus()
}

/** Create or tear down the overlay to match settings. Called at startup, on
 * activate, and whenever settings change. */
export function syncOverlay(): void {
  const m = getSettings().munu
  try {
    if (m.enabled && m.overlay) {
      createOverlayWindow()
      repositionOverlay()
      startCursorPoll()
      pushGlobal()
    } else {
      stopCursorPoll()
      destroyOverlay()
    }
  } catch (e) {
    // The floating overlay must never be able to break the app — it's optional.
    console.error('[munu] overlay sync failed:', e)
  }
}
