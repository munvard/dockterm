import { app, Menu, BrowserWindow, shell, type MenuItemConstructorOptions } from 'electron'
import { createWindow } from '../window'
import type { MenuAction } from '@shared/ipc'

const isMac = process.platform === 'darwin'

/** Route a File/View menu item to the focused renderer (it owns tabs/panes). */
function send(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', { action })
}

/**
 * Build and install the application menu (the macOS menu bar / Windows-Linux
 * window menu). Items that act on tabs/panes are forwarded to the focused
 * renderer via `menu:action`; the rest use Electron's built-in roles.
 *
 * Accelerators that the renderer already binds itself (⌘T/⌘W/⌘N/⌘D) are shown as
 * hints with `registerAccelerator: false`, so the menu doesn't double-register
 * them and the existing in-app shortcuts keep working untouched.
 */
export function setupAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          registerAccelerator: false,
          click: () => send('newTab')
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          registerAccelerator: false,
          click: () => createWindow()
        },
        { type: 'separator' },
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('openProject') },
        ...(isMac ? [] : ([{ label: 'Settings…', click: () => send('settings') }] as MenuItemConstructorOptions[])),
        { type: 'separator' },
        {
          label: 'Split Right',
          accelerator: 'CmdOrCtrl+D',
          registerAccelerator: false,
          click: () => send('splitRight')
        },
        { label: 'Split Down', click: () => send('splitDown') },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          registerAccelerator: false,
          click: () => send('closeTab')
        },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        // ⌘R is owned by the renderer (chat-mode toggle, Shell.tsx) — keep the
        // menu item and its default label/behavior, just stop the menu from
        // registering the accelerator so the in-app shortcut reaches it.
        { role: 'reload', accelerator: 'CmdOrCtrl+R', registerAccelerator: false },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ] as MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'DockTerm on GitHub',
          click: () => void shell.openExternal('https://github.com/munvard/dockterm')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
