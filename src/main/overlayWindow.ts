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
  // Float above everything, on every Space, including fullscreen apps.
  overlay.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  // Start click-through; the renderer enables interaction while hovering munu.
  overlay.setIgnoreMouseEvents(true, { forward: true })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void overlay.loadURL(devUrl ? `${devUrl}/overlay.html` : OVERLAY_URL)
  overlay.once('ready-to-show', () => overlay?.showInactive())
  overlay.on('closed', () => {
    overlay = null
  })
  return overlay
}

export function getOverlay(): BrowserWindow | null {
  return overlay && !overlay.isDestroyed() ? overlay : null
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

/** Re-center on the primary display (call when displays change). */
export function repositionOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const { x, y } = topCenter()
  overlay.setPosition(x, y)
}
