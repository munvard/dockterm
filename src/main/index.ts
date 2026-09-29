import { app, BrowserWindow } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { createMainWindow, isPrimaryWindow } from './window'
import { registerAppSchemePrivileges, serveAppProtocol } from './protocol'
import { applyGlobalSecurity } from './security'
import { registerIpc } from './ipc/register'
import { killAllPtys } from './services/ptyService'
import { stopAllWatchers } from './services/watcherService'
import { setupMenubar, teardownMenubar } from './services/menubarService'
import { setupAppMenu } from './services/appMenu'
import { syncOverlay } from './services/munuService'
import { startUpdateChecker } from './services/updateChecker'
import { startUsageWatcher } from './services/usageService'
import { startAgentWatcher } from './services/agentActivityService'
import { startSessionHistoryWatcher } from './services/sessionHistoryService'
import { setPendingOpen } from './services/pendingOpen'
import { destroyOverlay, getOverlay } from './overlayWindow'

// node-pty's Windows conpty backend can re-launch the packaged .exe itself as a
// helper process (conpty_console_list_agent) when the RunAsNode fuse is off. If
// that ever happens, it must exit immediately instead of booting a second full
// DockTerm — checked before anything else (requestSingleInstanceLock included).
if (process.argv.includes('conpty_console_list_agent')) {
  app.exit(0)
} else {
  // Must run before `app` is ready.
  registerAppSchemePrivileges()

  // Windows groups notifications/taskbar entries by AppUserModelId; without one
  // set, toast notifications from an unsigned/unpackaged build can silently not
  // appear at all.
  if (process.platform === 'win32') app.setAppUserModelId('com.dockterm.app')

  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    /** The window a second launch (or an OS "open with") should act on: the
     * current primary window if one is open, else any other real window —
     * NEVER the always-open, non-interactive munu overlay. */
    function pickTargetWindow(): BrowserWindow | null {
      const overlay = getOverlay()
      const windows = BrowserWindow.getAllWindows().filter((w) => w !== overlay)
      return windows.find((w) => isPrimaryWindow(w.webContents.id)) ?? windows[0] ?? null
    }

    function focusWindow(win: BrowserWindow): void {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }

    /** A directory path passed on a second launch's command line (e.g.
     * `dockterm /path/to/project`, or an OS file-manager "open with"). Skips
     * flags and the executable/script path itself. */
    function findOpenPath(argv: string[]): string | null {
      for (const arg of argv) {
        if (arg.startsWith('-')) continue
        try {
          if (existsSync(arg) && statSync(arg).isDirectory()) return arg
        } catch {
          // not a real path — ignore
        }
      }
      return null
    }

    function openPathInWindow(win: BrowserWindow, path: string): void {
      if (win.webContents.isLoading()) {
        win.webContents.once('did-finish-load', () => win.webContents.send('project:openRequested', { path }))
      } else {
        win.webContents.send('project:openRequested', { path })
      }
    }

    // A path passed to `open -a DockTerm <path>` / a Finder "Open With" arrives
    // via 'open-file' (macOS), not argv — captured even if it fires before the
    // app (or a window) is ready, and flushed once one exists.
    app.on('open-file', (event, filePath) => {
      event.preventDefault()
      if (!app.isReady()) {
        setPendingOpen(filePath)
        return
      }
      const win = pickTargetWindow()
      if (!win) {
        // No window to hand it to (macOS, app alive): open one; its renderer
        // takes the pending folder while it starts up.
        setPendingOpen(filePath)
        createMainWindow()
        syncOverlay()
        return
      }
      focusWindow(win)
      openPathInWindow(win, filePath)
    })

    app.on('second-instance', (_event, argv) => {
      const win = pickTargetWindow()
      if (!win) return
      focusWindow(win)
      const path = findOpenPath(argv)
      if (path) openPathInWindow(win, path)
    })

    void app.whenReady().then(() => {
      applyGlobalSecurity()
      serveAppProtocol()
      registerIpc()
      createMainWindow()
      setupAppMenu()
      setupMenubar()
      syncOverlay()
      startUpdateChecker()
      startUsageWatcher()
      startAgentWatcher()
      startSessionHistoryWatcher()

      // A folder queued before the window existed stays pending: the renderer
      // pulls it (project:takePendingOpen) before it restores the last project.

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow()
          syncOverlay()
        }
      })
    })

    app.on('will-quit', () => {
      teardownMenubar()
      destroyOverlay()
    })

    app.on('before-quit', () => {
      killAllPtys()
      stopAllWatchers()
    })

    app.on('window-all-closed', () => {
      killAllPtys()
      stopAllWatchers()
      if (process.platform !== 'darwin') app.quit()
    })
  }
}
