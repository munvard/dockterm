import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { APP_URL } from './protocol'
import { killPtysForWindow } from './services/ptyService'
import { stopWatchingById } from './services/watcherService'
import { clearActiveRoot } from './services/activeRoot'
import { getSettings } from './services/settingsService'

const openWindows = new Set<number>()
let primaryId: number | null = null

export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    show: false,
    // Transparent on macOS so the window vibrancy shows through translucent chrome.
    backgroundColor: isMac ? '#00000000' : '#0d0d0f',
    title: 'DockTerm',
    autoHideMenuBar: true,
    // macOS: hide the OS title bar (content runs to the top edge) but keep the
    // inset traffic-light buttons, and add native frosted-glass vibrancy.
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 13 },
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false
    }
  })

  const id = win.webContents.id
  openWindows.add(id)
  if (primaryId === null) primaryId = id

  applyWindowSecurity(win)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    openWindows.delete(id)
    killPtysForWindow(id)
    stopWatchingById(id)
    clearActiveRoot(id)
    if (primaryId === id) primaryId = openWindows.values().next().value ?? null
  })

  // Apply the saved UI zoom on every (re)load — setZoomFactor resets on reload.
  win.webContents.on('did-finish-load', () => {
    try {
      win.webContents.setZoomFactor(getSettings().ui.zoom)
    } catch {
      // window may be gone
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  void win.loadURL(devUrl ?? APP_URL)

  return win
}

/** Apply a zoom factor to every open window (used by the ui:setZoom handler). */
export function applyZoomToAllWindows(factor: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.setZoomFactor(factor)
      } catch {
        // ignore destroyed/loading windows
      }
    }
  }
}

/** Alias kept for the app bootstrap. */
export const createMainWindow = createWindow

/** The first/primary window owns workspace persistence (secondary windows are
 * session-scoped). */
export function isPrimaryWindow(webContentsId: number): boolean {
  return webContentsId === primaryId
}
