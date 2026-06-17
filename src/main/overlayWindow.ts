import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { OVERLAY_URL } from './protocol'

/**
 * The munu overlay: a frameless, transparent, always-on-top, non-focusable
 * window pinned to the top-center of the display with the menu bar (over the
 * notch on a MacBook). It floats above other apps and all Spaces — including
 * fullscreen — so munu's state is visible even when DockTerm is in the
 * background. The window is click-through except where the renderer reports the
 * cursor is over munu (toggled via setOverlayInteractive).
 */
let overlay: BrowserWindow | null = null

const W = 380
const H = 260

function topCenter(): { x: number; y: number } {
  const d = screen.getPrimaryDisplay()
  return { x: Math.round(d.bounds.x + (d.bounds.width - W) / 2), y: d.bounds.y }
}

export function createOverlayWindow(): BrowserWindow {
  if (overlay && !overlay.isDestroyed()) return overlay
  const { x, y } = topCenter()
  overlay = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
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
  overlay.setIgnoreMouseEvents(true, { forward: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void overlay.loadURL(devUrl ? `${devUrl}/overlay.html` : OVERLAY_URL)
  overlay.once('ready-to-show', () => {
    overlay?.showInactive()
    reassertOverlayLevel()
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
 * Called ONCE at setup (not on a timer): revealing munu is pure CSS, so the
 * window itself just stays present and always-on-top everywhere.
 *
 * ORDER MATTERS: setAlwaysOnTop resets the macOS collectionBehavior, so
 * setVisibleOnAllWorkspaces must come AFTER it.
 *
 * We deliberately do NOT pass skipTransformProcessType: the default process-type
 * transform (briefly flipping the app to an accessory) is exactly what lets the
 * window cross into ANOTHER app's fullscreen Space. Skipping it (to avoid a Dock
 * flicker) is what previously kept munu from appearing over fullscreen. Calling
 * this once means the one-time flicker is acceptable.
 */
export function reassertOverlayLevel(): void {
  if (!overlay || overlay.isDestroyed()) return
  try {
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    // window may be gone
  }
}

export function destroyOverlay(): void {
  if (overlay && !overlay.isDestroyed()) overlay.destroy()
  overlay = null
}

export function setOverlayInteractive(interactive: boolean): void {
  if (overlay && !overlay.isDestroyed()) {
    overlay.setIgnoreMouseEvents(!interactive, { forward: true })
  }
}

/** Temporarily make the overlay focusable so its text field can receive typing.
 * (The window is non-focusable by default so it never steals focus.) */
export function setOverlayFocusable(focusable: boolean): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.setFocusable(focusable)
  if (focusable) overlay.focus()
}

/** Re-center on the primary display (call when displays change). */
export function repositionOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const { x, y } = topCenter()
  overlay.setPosition(x, y)
}

/**
 * Resize the floating window to fit its content (the renderer measures it) so
 * munu's card is shown fully — small when it fits small, taller when there are
 * many options. Clamped to the display so it can never run off-screen.
 */
export function resizeOverlay(width: number, height: number): void {
  if (!overlay || overlay.isDestroyed()) return
  const d = screen.getPrimaryDisplay()
  const w = Math.min(Math.max(width, 120), d.workArea.width - 16)
  const h = Math.min(Math.max(height, 80), d.bounds.height - 24)
  const x = Math.round(d.bounds.x + (d.bounds.width - w) / 2)
  overlay.setBounds({ x, y: d.bounds.y, width: Math.round(w), height: Math.round(h) })
}
