import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { OVERLAY_URL } from './protocol'
import { getSettings } from './services/settingsService'
import { clampToAreas } from './overlayPlacement'

/**
 * The munu overlay: a frameless, transparent, always-on-top, non-focusable
 * window. By default it sits at the top-center of the display with the menu bar
 * (over the notch on a MacBook); when the user pins munu it moves to their saved
 * position anywhere on screen (see placeOverlay). It floats above other apps and
 * all Spaces — including fullscreen — so munu's state is visible even when
 * DockTerm is in the background. The window is click-through except where the
 * renderer reports the cursor is over munu (toggled via setOverlayInteractive).
 */
let overlay: BrowserWindow | null = null

const W = 380
const H = 260
const isLinux = process.platform === 'linux'

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
      const b = overlay.getBounds()
      placeOverlay(b.width, b.height)
    }, delay)
  }
}

/**
 * Position the overlay at size `w×h`.
 * - `anchor: 'topleft'` (default) pins the window's top-left to the saved
 *   position — used for the initial placement / repositioning.
 * - `anchor: 'center'` keeps munu (which sits at the window's horizontal centre)
 *   visually put while the window grows/shrinks — used when the popup opens or
 *   closes, so a pinned munu no longer jumps sideways.
 */
function placeOverlay(width: number, height: number, anchor: 'topleft' | 'center' = 'topleft'): void {
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
    let bx = m.position.x
    let by = m.position.y
    if (anchor === 'center') {
      const cur = overlay.getBounds()
      bx = Math.round(cur.x + cur.width / 2 - w / 2)
      by = cur.y
    }
    const { x, y } = clampToAreas({ x: bx, y: by, width: w, height: h }, areas)
    overlay.setBounds({ x, y, width: w, height: h })
  } else {
    // Resting munu tucks at the very top (over the notch). Height is already
    // clamped to the work area, so even a tall card's footer stays above the dock.
    const d = screen.getPrimaryDisplay()
    const x = Math.round(d.bounds.x + (d.bounds.width - w) / 2)
    overlay.setBounds({ x, y: d.bounds.y, width: w, height: h })
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
      sandbox: true
    }
  })

  applyWindowSecurity(overlay)
  // Start click-through; the renderer enables interaction while hovering munu.
  // Linux/Wayland can't forward mouse-move to a click-through window, so there
  // the renderer could never detect a hover to flip it interactive — keep munu
  // clickable from the start on Linux so it can be used at all.
  if (isLinux) overlay.setIgnoreMouseEvents(false)
  else overlay.setIgnoreMouseEvents(true, { forward: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void overlay.loadURL(devUrl ? `${devUrl}/overlay.html` : OVERLAY_URL)
  overlay.once('ready-to-show', () => {
    placeOverlay(W, H)
    overlay?.showInactive()
    reassertOverlayLevel()
    repinLinux()
  })
  overlay.on('closed', () => {
    overlay = null
  })
  return overlay
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
}

export function setOverlayInteractive(interactive: boolean): void {
  if (!overlay || overlay.isDestroyed()) return
  // On Linux the overlay stays interactive (mouse-forward isn't supported, so
  // toggling click-through would make munu permanently unclickable).
  if (isLinux) {
    overlay.setIgnoreMouseEvents(false)
    return
  }
  overlay.setIgnoreMouseEvents(!interactive, { forward: true })
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
  const b = overlay.getBounds()
  placeOverlay(b.width, b.height)
}

/** Resize to fit content. When `expanded` (the popup / ask-card is open) the
 * window grows around munu's centre so a pinned munu stays visually put; at rest
 * it returns to its saved top-left. */
export function resizeOverlay(width: number, height: number, expanded = false): void {
  placeOverlay(width, height, expanded ? 'center' : 'topleft')
}

/** Current screen bounds, or null if the overlay isn't up. */
export function getOverlayBounds(): { x: number; y: number; width: number; height: number } | null {
  if (!overlay || overlay.isDestroyed()) return null
  const b = overlay.getBounds()
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

/** Move to an absolute screen position, clamped to stay on a display. */
export function moveOverlay(x: number, y: number): void {
  if (!overlay || overlay.isDestroyed()) return
  const b = overlay.getBounds()
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  const p = clampToAreas({ x, y, width: b.width, height: b.height }, areas)
  overlay.setPosition(p.x, p.y)
}
