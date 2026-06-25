import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
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
import { destroyOverlay } from './overlayWindow'

// Must run before `app` is ready.
registerAppSchemePrivileges()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
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
