import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { APP_URL } from './protocol'
import { killPtysForWindow } from './services/ptyService'
import { stopWatchingById } from './services/watcherService'
import { clearActiveRoot } from './services/activeRoot'
import { clearGrants } from './services/pathGrants'
import { getSettings, setLastProjectPath } from './services/settingsService'
import { getWindowProject } from './services/windowNamespace'
import { dropWindowMunu } from './services/munuService'
import { destroyOverlay, getOverlay } from './overlayWindow'
import { registerWindowRole, unregisterWindowRole } from './ipc/windowRoles'

const openWindows = new Set<number>()
let primaryId: number | null = null
/** How many windows this session has created — used only to cascade-offset a
 * new window's position so it never lands exactly on top of the last one. */
let createdCount = 0

/** PTYs and watches a window owns must never outlive its renderer — a full
 * window close already tears these down; a page RELOAD or a crashed renderer
 * used to leave them running as orphans (invisible to the fresh renderer,
 * which starts from a clean slate and spawns new ones on top). */
function cleanupWindowResources(id: number): void {
  killPtysForWindow(id)
  stopWatchingById(id)
  clearActiveRoot(id)
  clearGrants(id)
  dropWindowMunu(id)
}

export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const offset = (createdCount++ % 8) * 24
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 320,
    ...(offset > 0 ? { x: 60 + offset, y: 60 + offset } : {}),
    show: false,
    // Transparent on macOS so the window vibrancy shows through translucent chrome.
    backgroundColor: isMac ? '#00000000' : '#1e1e1d',
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
  registerWindowRole(id, 'main')
  openWindows.add(id)
  if (primaryId === null) primaryId = id

  applyWindowSecurity(win)
  win.once('ready-to-show', () => win.show())

  // A page reload (dev tools, a crash-recovery reload) past the FIRST load, or
  // the renderer process itself dying, must clean up this window's PTYs/watch
  // the same way closing it would — otherwise the fresh renderer starts from a
  // blank slate while the old PTYs/watcher keep running invisibly.
  let loadedOnce = false
  win.webContents.once('did-finish-load', () => {
    loadedOnce = true
  })
  win.webContents.on('did-start-navigation', (details) => {
    if (loadedOnce && details.isMainFrame && !details.isSameDocument) cleanupWindowResources(id)
  })
  win.webContents.on('render-process-gone', () => cleanupWindowResources(id))

  win.on('closed', () => {
    unregisterWindowRole(id)
    openWindows.delete(id)
    cleanupWindowResources(id)
    if (primaryId === id) {
      primaryId = openWindows.values().next().value ?? null
      if (primaryId !== null) {
        const newPrimary = BrowserWindow.getAllWindows().find((w) => w.webContents.id === primaryId)
        if (newPrimary && !newPrimary.isDestroyed()) {
          // The new primary persists ITS workspace (projectPath = its project), so
          // the remembered project must follow, or a relaunch opens the old one
          // and refuses to restore a layout saved for another folder.
          const project = getWindowProject(primaryId)
          if (project) setLastProjectPath(project)
          newPrimary.webContents.send('window:primaryChanged', true)
        }
      }
    }
    // No main windows left → close the floating overlay so the app can quit
    // (the overlay is otherwise an always-open window).
    if (openWindows.size === 0) destroyOverlay()
  })

  // Apply the saved UI zoom on every (re)load — setZoomFactor resets on reload.
  win.webContents.on('did-finish-load', () => {
    try {
      win.webContents.setZoomFactor(getSettings().ui.zoom)
    } catch {
      // window may be gone
    }
  })

  // Only honor a dev server URL in an unpackaged (development) build — a
  // packaged build must never point at a stray ELECTRON_RENDERER_URL left in
  // the environment.
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  void win.loadURL(devUrl ?? APP_URL)

  return win
}

/** Apply a zoom factor to every open MAIN window (used by the ui:setZoom
 * handler) — the munu overlay is a status surface, not a document, and must
 * never be zoomed along with it. */
export function applyZoomToAllWindows(factor: number): void {
  const overlay = getOverlay()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win === overlay || win.isDestroyed()) continue
    try {
      win.webContents.setZoomFactor(factor)
    } catch {
      // ignore destroyed/loading windows
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
