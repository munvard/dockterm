import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerAppSchemePrivileges, serveAppProtocol } from './protocol'
import { applyGlobalSecurity } from './security'
import { registerIpc } from './ipc/register'
import { killAllPtys } from './services/ptyService'

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

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('before-quit', () => killAllPtys())

  app.on('window-all-closed', () => {
    killAllPtys()
    if (process.platform !== 'darwin') app.quit()
  })
}
