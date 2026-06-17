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
