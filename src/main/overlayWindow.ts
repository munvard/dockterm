import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { OVERLAY_URL } from './protocol'
import { getSettings } from './services/settingsService'
import {
  anchorFromSaved,
  boxAtAnchor,
  canvasAreaFor,
  clampToAreas,
  cursorOverHit,
  frameInCanvas,
  hitRectOnScreen,
  normalizeHit,
  sameRect,
  savedFromAnchor,
  usesCanvas,
  type Box,
  type HitRegion,
  type MunuAnchor
} from './overlayPlacement'
import { registerWindowRole, unregisterWindowRole } from './ipc/windowRoles'

/**
 * The munu overlay: a frameless, transparent, always-on-top, non-focusable
 * window. By default it sits at the top-center of the display with the menu bar
 * (over the notch on a MacBook); when the user pins munu it moves to their saved
 * position anywhere on screen (see placeOverlay). It floats above other apps and
 * all Spaces — including fullscreen — so munu's state is visible even when
 * DockTerm is in the background. The window is click-through except while main
 * sees the cursor over munu (see the hit poll below).
 */
let overlay: BrowserWindow | null = null

const W = 380
const H = 260
const isLinux = process.platform === 'linux'

/**
 * Windows and macOS: the overlay window is a fixed, click-through canvas over the
 * work area (Windows) or the whole display (macOS, munu rests over the notch) of
 * munu's display, and munu is drawn inside it at `box` (sent to the renderer as
 * `munu:frame`). Resizing a transparent window shows the old picture at the new
 * origin for one frame, so munu jumped sideways whenever its popup opened or
 * closed. With a canvas the window is only moved when munu crosses to another
 * display. On Linux `box` is simply the window's bounds.
 */
const useCanvas = usesCanvas(process.platform)
let box: Box = { x: 0, y: 0, width: W, height: H }
let canvas: Box | null = null

/** munu's current screen rect (the virtual box on Windows, the window elsewhere). */
function currentBox(): Box {
  if (useCanvas || !overlay || overlay.isDestroyed()) return { ...box }
  const b = overlay.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/** Put munu at `next`. `moveOnly` keeps the native size (a drag step). */
function applyBox(next: Box, moveOnly = false): void {
  if (!overlay || overlay.isDestroyed()) return
  box = next
  if (!useCanvas) {
    if (moveOnly) overlay.setPosition(next.x, next.y)
    else overlay.setBounds(next)
    return
  }
  const area = canvasAreaFor(process.platform, screen.getDisplayMatching(next))
  if (!sameRect(canvas, area)) {
    canvas = area
    overlay.setBounds(canvas)
  }
  overlay.webContents.send('munu:frame', frameInCanvas(next, canvas as Box))
}

/**
 * Re-apply placement a few times after a short beat — Linux only.
 *
 * On X11, window managers frequently move a frameless, transparent,
 * non-focusable, always-on-top window right after it maps (and again right after
 * `setAlwaysOnTop`), ignoring our requested bounds — so munu lands at the screen
 * edge instead of the top-center where the cursor-reveal zone lives, which makes
 * it look like it never appears. Re-running placement once the WM has settled
 * puts it back. Reuses placeOverlay, so a pinned position is still honored.
 * (Wayland forbids client-side window positioning outright; an X11/XWayland
 * session is required there for the overlay to sit correctly.)
 */
function repinLinux(): void {
  if (!isLinux) return
  for (const delay of [60, 200, 500]) {
    setTimeout(() => {
      if (!overlay || overlay.isDestroyed()) return
      const b = currentBox()
      placeOverlay(b.width, b.height)
    }, delay)
  }
}

// Where a pinned munu is anchored (null while unpinned). Every resize keeps this
// point; only a drag or a new saved position moves it. Clamping is applied per
// placement and never written back, so opening a card near an edge doesn't drift.
let anchor: MunuAnchor | null = null

/**
 * Position the overlay at size `w×h`. A pinned munu keeps its centre on `anchor`,
 * so it stays put while its content grows or shrinks; `fromSaved` first re-reads
 * the anchor from the saved position (startup, display or settings change).
 */
function placeOverlay(width: number, height: number, fromSaved = false): void {
  if (!overlay || overlay.isDestroyed()) return
  const m = getSettings().munu
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  // The work area of the display this overlay lives on (where it's pinned, else
  // the primary). Clamp to the WORK area — not the full display bounds — so a
  // tall card's last row (the cancel / open-terminal footer) is always on-screen
  // and never tucked under the dock or past the bottom edge.
  const target =
    m.pinned && m.position
      ? screen.getDisplayNearestPoint(m.position).workArea
      : screen.getPrimaryDisplay().workArea
  const w = Math.round(Math.min(Math.max(width, 120), target.width - 16))
  const h = Math.round(Math.min(Math.max(height, 80), target.height - 12))
  if (m.pinned && m.position) {
    if (fromSaved || !anchor) anchor = anchorFromSaved(m.position, W)
    const b = boxAtAnchor(anchor, w, h)
    const { x, y } = clampToAreas(b, areas)
    applyBox({ x, y, width: w, height: h })
  } else {
    anchor = null
    // Resting munu tucks at the very top (over the notch). Height is already
    // clamped to the work area, so even a tall card's footer stays above the dock.
    const d = screen.getPrimaryDisplay()
    const x = Math.round(d.bounds.x + (d.bounds.width - w) / 2)
    // macOS/Windows intentionally sit at the very top of the display bounds
    // (macOS to cover the notch; Windows has no reserved top strip in the
    // common case). Linux desktop panels vary widely and are often docked at
    // the TOP of the screen, so bounds.y there would place munu under/behind
    // the panel — use workArea.y instead so it rests just below it.
    // The Windows canvas covers the work area, so munu rests at its top.
    const y = isLinux || useCanvas ? d.workArea.y : d.bounds.y
    applyBox({ x, y, width: w, height: h })
  }
}

export function createOverlayWindow(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay
  overlay = new BrowserWindow({
    width: W,
    height: H,
    x: 0,
    y: 0,
    // macOS: a 'panel' window gets the NSWindowStyleMaskNonactivatingPanel mask
    // at runtime, so it floats OVER other apps' fullscreen Spaces and joins all
    // desktops — the same mechanism native notch apps use (an NSPanel). This is
    // what makes munu visible when you're in another window's fullscreen Space.
    // (Type must be set at construction; only valid on macOS.)
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // Non-activating panel: it floats over other apps (incl. their fullscreen
    // Space) without ever stealing focus or pulling you out of that Space.
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    roundedCorners: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Never throttle this renderer when DockTerm is in the background. The
      // overlay is an always-on-top status surface that must keep reacting to
      // live events (agent activity, munu state) even while you're in another
      // app — otherwise the swarm/peek wouldn't appear until DockTerm refocuses.
      backgroundThrottling: false
    }
  })

  const overlayId = overlay.webContents.id
  registerWindowRole(overlayId, 'overlay')
  applyWindowSecurity(overlay)
  // Start click-through; main turns interaction on while the cursor is over munu
  // (hit poll below). Linux/Wayland can't query the cursor, so there munu stays
  // clickable from the start so it can be used at all.
  if (isLinux) overlay.setIgnoreMouseEvents(false)
  else overlay.setIgnoreMouseEvents(true)

  // Only ever honored in dev (electron-vite sets this for the Vite dev
  // server) — a packaged build must never load overlay content from a URL an
  // environment variable could point anywhere.
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  void overlay.loadURL(devUrl ? `${devUrl}/overlay.html` : OVERLAY_URL)
  overlay.once('ready-to-show', () => {
    placeOverlay(W, H)
    overlay?.showInactive()
    reassertOverlayLevel()
    repinLinux()
  })
  // Resolution, DPI, taskbar or monitor changes move the work areas: re-place
  // munu (and, on Windows, resize the canvas to the new work area).
  for (const ev of DISPLAY_EVENTS) screen.on(ev as 'display-added', onDisplayChange)
  overlay.on('closed', () => {
    unregisterWindowRole(overlayId)
    stopDisplayWatch()
    stopHitPoll()
    overlay = null
    canvas = null
    hit = null
  })
  return overlay
}

const DISPLAY_EVENTS = ['display-added', 'display-removed', 'display-metrics-changed'] as const

function onDisplayChange(): void {
  canvas = null
  repositionOverlay()
}

function stopDisplayWatch(): void {
  for (const ev of DISPLAY_EVENTS) screen.removeListener(ev as 'display-added', onDisplayChange)
}

export function getOverlay(): BrowserWindow | null {
  return overlay && !overlay.isDestroyed() ? overlay : null
}

/**
 * Float above everything, on every Space, including other apps' fullscreen.
 *
 * The fullscreen-Space crossing is handled by the window's `type: 'panel'`
 * (NSWindowStyleMaskNonactivatingPanel) — set at construction. Here we just pin
 * the level high and (re)affirm all-spaces membership. Called ONCE at setup;
 * revealing munu is pure CSS so the window itself stays present everywhere.
 *
 * ORDER MATTERS: setAlwaysOnTop resets the macOS collectionBehavior, so
 * setVisibleOnAllWorkspaces must come AFTER it. skipTransformProcessType avoids
 * the Dock flicker — the panel type, not the process transform, is what gets us
 * over fullscreen now.
 */
export function reassertOverlayLevel(): void {
  if (!overlay || overlay.isDestroyed()) return
  try {
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    })
    // X11 WMs re-place the window right after always-on-top is set; re-pin it.
    repinLinux()
  } catch {
    // window may be gone
  }
}

export function destroyOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
  canvas = null
  hit = null
  stopHitPoll()
  stopDisplayWatch()
}

// Click-through control (Windows and macOS). The overlay covers a whole display, so
// it must pass every click through except those landing on munu. Chromium's
// forwarded mouse-move is a fragile signal for that (on Windows it comes from a
// low-level mouse hook the OS silently drops if the app stalls for a moment, after
// which hover never arrives again), so main decides itself: the renderer reports
// munu's clickable region (island, popup, card) while munu is visible, and a short
// poll compares the real cursor position with it. No region (munu tucked away) means
// no poll and a fully click-through window.
const HIT_POLL_MS = 33
const DRAG_HOLD_MS = 500
let hit: HitRegion | null = null
let hitTimer: ReturnType<typeof setInterval> | null = null
let interactive = false
let lastDragAt = 0

function stopHitPoll(): void {
  if (hitTimer) clearInterval(hitTimer)
  hitTimer = null
  interactive = false
}

function setInteractiveNow(next: boolean): void {
  if (!overlay || overlay.isDestroyed() || next === interactive) return
  interactive = next
  overlay.setIgnoreMouseEvents(!next)
  overlay.webContents.send('munu:hover', next)
}

function hitTick(): void {
  if (!overlay || overlay.isDestroyed() || !hit) return stopHitPoll()
  // A drag can run ahead of munu, so the cursor may briefly leave it mid-drag.
  const dragging = Date.now() - lastDragAt < DRAG_HOLD_MS
  const over = cursorOverHit(screen.getCursorScreenPoint(), hitRectOnScreen(box, hit), interactive)
  setInteractiveNow(over || dragging)
}

/** The renderer reports munu's clickable region, relative to munu's box, or null
 * when munu is tucked away. Starts or stops the cursor poll accordingly. */
export function setOverlayHit(region: Partial<HitRegion> | null): void {
  if (!overlay || overlay.isDestroyed() || isLinux) return
  hit = normalizeHit(region)
  if (!hit) {
    if (hitTimer) clearInterval(hitTimer)
    hitTimer = null
    setInteractiveNow(false)
    return
  }
  hitTick()
  if (!hitTimer) hitTimer = setInterval(hitTick, HIT_POLL_MS)
}

/** Kept for the old hover signal: the cursor poll above now owns click-through, so
 * a renderer hint can only matter on Linux, where munu always stays clickable. */
export function setOverlayInteractive(_interactive: boolean): void {
  if (!overlay || overlay.isDestroyed()) return
  if (isLinux) overlay.setIgnoreMouseEvents(false)
}

/** Temporarily make the overlay focusable so its text field can receive typing.
 * (The window is non-focusable by default so it never steals focus.) */
export function setOverlayFocusable(focusable: boolean): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.setFocusable(focusable)
  if (focusable) overlay.focus()
}

/** Re-apply placement (call on display change or when pin/position settings change). */
export function repositionOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const b = currentBox()
  placeOverlay(b.width, b.height, true)
}

/** Resize to fit content, keeping a pinned munu's centre where it is. */
export function resizeOverlay(width: number, height: number): void {
  placeOverlay(width, height)
}

/** Current screen bounds, or null if the overlay isn't up. For a pinned munu x/y
 * are the position to save (see anchorFromSaved), not the box's own corner. */
export function getOverlayBounds(): { x: number; y: number; width: number; height: number } | null {
  if (!overlay || overlay.isDestroyed()) return null
  const b = currentBox()
  return anchor ? { ...b, ...savedFromAnchor(anchor, W) } : b
}

/** Move to an absolute screen position, clamped to stay on a display. */
export function moveOverlay(x: number, y: number): void {
  if (!overlay || overlay.isDestroyed()) return
  const b = currentBox()
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  const p = clampToAreas({ x, y, width: b.width, height: b.height }, areas)
  applyBox({ x: p.x, y: p.y, width: b.width, height: b.height }, true)
  if (anchor) anchor = { cx: p.x + b.width / 2, y: p.y }
}

// Drag origin captured synchronously in main when a pinned-munu drag begins, so a
// drag never waits on a renderer→main getBounds round-trip (which, when slow, used
// to make munu "stick" and not follow the cursor). Each move recomputes the window
// position from this fixed origin + the total cursor delta, so it tracks 1:1 even
// after a clamp at the screen edge.
let dragOrigin: { sx: number; sy: number; wx: number; wy: number } | null = null

/** Begin a munu drag: remember the cursor's screen position and munu's window
 * position at this instant. `sx`/`sy` are the pointer's screen coordinates. */
export function beginOverlayDrag(sx: number, sy: number): void {
  if (!overlay || overlay.isDestroyed()) return
  const b = currentBox()
  dragOrigin = { sx, sy, wx: b.x, wy: b.y }
  lastDragAt = Date.now()
}

/** Continue a munu drag to the cursor's current screen position. */
export function dragOverlay(sx: number, sy: number): void {
  if (!dragOrigin) return
  lastDragAt = Date.now()
  moveOverlay(dragOrigin.wx + (sx - dragOrigin.sx), dragOrigin.wy + (sy - dragOrigin.sy))
}
