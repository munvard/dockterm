import { app, Menu, BrowserWindow, shell } from 'electron'
import { createWindow } from '../window'
import { getOverlay } from '../overlayWindow'
import type { MenuAction } from '@shared/ipc'
import { buildMenuTemplate } from './appMenuTemplate'

/** Route a File/View menu item to the focused renderer (it owns tabs/panes).
 * The munu overlay is a BrowserWindow too (always present, never focused for
 * typing) — never let it stand in for "the app window" here. */
function send(action: MenuAction): void {
  const overlay = getOverlay()
  const focused = BrowserWindow.getFocusedWindow()
  const win =
    focused && focused !== overlay ? focused : BrowserWindow.getAllWindows().find((w) => w !== overlay)
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
    openExternal: (url) => void shell.openExternal(url)
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
