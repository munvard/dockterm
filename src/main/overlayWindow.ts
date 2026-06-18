import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { OVERLAY_URL } from './protocol'
import { getSettings } from './services/settingsService'
import { clampToAreas } from './overlayPlacement'

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

function placeOverlay(width: number, height: number): void {
  if (!overlay || overlay.isDestroyed()) return
  const m = getSettings().munu
  const w = Math.round(Math.min(Math.max(width, 120), screen.getPrimaryDisplay().workArea.width - 16))
  const h = Math.round(Math.min(Math.max(height, 80), screen.getPrimaryDisplay().bounds.height - 24))
  if (m.pinned && m.position) {
    const areas = screen.getAllDisplays().map((d) => d.workArea)
    const { x, y } = clampToAreas({ x: m.position.x, y: m.position.y, width: w, height: h }, areas)
    overlay.setBounds({ x, y, width: w, height: h })
  } else {
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
  overlay.setIgnoreMouseEvents(true, { forward: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void overlay.loadURL(devUrl ? `${devUrl}/overlay.html` : OVERLAY_URL)
  overlay.once('ready-to-show', () => {
    placeOverlay(W, H)
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

/** Re-apply placement (call on display change or when pin/position settings change). */
export function repositionOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const b = overlay.getBounds()
  placeOverlay(b.width, b.height)
}

/** Resize to fit content; respects pinned position (won't recenter when pinned). */
export function resizeOverlay(width: number, height: number): void {
  placeOverlay(width, height)
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
