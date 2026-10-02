import { app, dialog, Menu, BrowserWindow, shell } from 'electron'
import { createWindow } from '../window'
import { getOverlay } from '../overlayWindow'
import { getUsageWidget } from '../usageFloatWindow'
import type { MenuAction } from '@shared/ipc'
import { buildMenuTemplate } from './appMenuTemplate'
import { countPtysForWindow } from './ptyService'
import { guardedReload, reloadWarning } from './reloadGuard'

/** Route a File/View menu item to the focused renderer (it owns tabs/panes).
 * The munu overlay is a BrowserWindow too (always present, never focused for
 * typing) — never let it stand in for "the app window" here. */
function send(action: MenuAction): void {
  const overlay = getOverlay()
  const widget = getUsageWidget()
  const focused = BrowserWindow.getFocusedWindow()
  const win =
    focused && focused !== overlay && focused !== widget
      ? focused
      : BrowserWindow.getAllWindows().find((w) => w !== overlay && w !== widget)
  win?.webContents.send('menu:action', { action })
}

/**
 * Build and install the application menu (the macOS menu bar / Windows-Linux
 * window menu). Items that act on tabs/panes are forwarded to the focused
 * renderer via `menu:action`. The key rules live in appMenuTemplate.ts.
 */
export function setupAppMenu(): void {
  const template = buildMenuTemplate(process.platform, {
    appName: app.name,
    send,
    newWindow: () => createWindow(),
    openExternal: (url) => void shell.openExternal(url),
    reload: (win, ignoreCache) => {
      if (!win || win.isDestroyed()) return
      void guardedReload(
        {
          liveTerminals: () => countPtysForWindow(win.webContents.id),
          confirm: async (count) => {
            const w = reloadWarning(count)
            const res = await dialog.showMessageBox(win, {
              type: 'warning',
              buttons: ['Reload', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              message: w.message,
              detail: w.detail
            })
            return res.response === 0
          },
          reload: (ic) => (ic ? win.webContents.reloadIgnoringCache() : win.webContents.reload())
        },
        ignoreCache
      )
    }
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
