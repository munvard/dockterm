import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { MenuAction } from '@shared/ipc'

export interface MenuDeps {
  appName: string
  /** Route an action to the focused renderer (it owns tabs/panes/dialogs). */
  send: (action: MenuAction) => void
  newWindow: () => void
  openExternal: (url: string) => void
  /** Reload a window, asking first when it has live terminals. */
  reload: (win: BrowserWindow | undefined, ignoreCache: boolean) => void
}

/**
 * The application menu, as data, so the key rules are testable without Electron.
 *
 * Key rules (see the renderer's hooks/keys.ts, which OWNS every app shortcut):
 *  - macOS: app shortcuts are Cmd+key. Windows/Linux: Ctrl+Shift+key. Plain
 *    Ctrl+letter is always left to the shell (Ctrl+C, Ctrl+O, Ctrl+Q … are real
 *    terminal keys), so no win/linux item may REGISTER one.
 *  - An action the renderer already handles is shown as a hint with
 *    `registerAccelerator: false`, so the menu never double-fires it and the
 *    label still shows the real key.
 */
export function buildMenuTemplate(platform: NodeJS.Platform, deps: MenuDeps): MenuItemConstructorOptions[] {
  const isMac = platform === 'darwin'
  /** The app's shortcut for `key` on this platform, as a menu accelerator. */
  const appKey = (key: string): string => (isMac ? `Cmd+${key}` : `Ctrl+Shift+${key}`)
  /** Renderer-owned: show the key, never register it. */
  const hint = (key: string): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> => ({
    accelerator: appKey(key),
    registerAccelerator: false
  })
  /** Editing / window roles default to plain Ctrl+letter on win/linux (Ctrl+C
   * would be grabbed from the terminal). Inputs and Monaco handle these keys
   * natively, so the label stays and the global grab goes. */
  const noGrab: Pick<MenuItemConstructorOptions, 'registerAccelerator'> = isMac
    ? {}
    : { registerAccelerator: false }

  return [
    ...(isMac
      ? ([
          {
            label: deps.appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings…', accelerator: 'Cmd+,', click: () => deps.send('settings') },
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
        { label: 'New Tab', ...hint('T'), click: () => deps.send('newTab') },
        { label: 'New Window', ...hint('N'), click: () => deps.newWindow() },
        { type: 'separator' },
        { label: 'Open Project…', ...hint('O'), click: () => deps.send('openProject') },
        ...(isMac
          ? []
          : ([
              {
                label: 'Settings…',
                accelerator: 'Ctrl+,',
                registerAccelerator: false,
                click: () => deps.send('settings')
              }
            ] as MenuItemConstructorOptions[])),
        { type: 'separator' },
        { label: 'Split Right', ...hint('D'), click: () => deps.send('splitRight') },
        { label: 'Split Down', click: () => deps.send('splitDown') },
        { type: 'separator' },
        // ⌘W / Ctrl+Shift+W closes the focused PANE, not the whole tab, so this
        // item carries no key hint.
        { label: 'Close Tab', click: () => deps.send('closeTab') },
        isMac ? { role: 'close' } : { role: 'quit', accelerator: 'Ctrl+Shift+Q' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', ...noGrab },
        { role: 'redo', ...noGrab },
        { type: 'separator' },
        { role: 'cut', ...noGrab },
        { role: 'copy', ...noGrab },
        { role: 'paste', ...noGrab },
        { role: 'selectAll', ...noGrab }
      ]
    },
    {
      label: 'View',
      submenu: [
        // Not the `reload` / `forceReload` roles: their default keys (Ctrl+R,
        // Ctrl+Shift+R) are the shell's reverse-search and the renderer's own
        // chat-mode toggle, and a role cannot hide its key label.
        { label: 'Reload', click: (_item, win) => deps.reload(win as BrowserWindow | undefined, false) },
        { label: 'Force Reload', click: (_item, win) => deps.reload(win as BrowserWindow | undefined, true) },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        // Their win/linux defaults are plain Ctrl+0 / Ctrl+Plus / Ctrl+-, which the
        // terminal owns (Ctrl+- is readline's undo). The renderer zooms on
        // Ctrl+Shift+ these keys, so show that and never register the plain ones.
        { role: 'resetZoom', ...(isMac ? {} : { accelerator: 'Ctrl+Shift+0', registerAccelerator: false }) },
        { role: 'zoomIn', ...(isMac ? {} : { accelerator: 'Ctrl+Shift+=', registerAccelerator: false }) },
        { role: 'zoomOut', ...(isMac ? {} : { accelerator: 'Ctrl+Shift+-', registerAccelerator: false }) },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        // win/linux 'minimize'/'close' default to Ctrl+M / Ctrl+W — a carriage
        // return and delete-word in a terminal. macOS keeps Cmd+M / Cmd+W.
        { role: 'minimize', ...noGrab },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ] as MenuItemConstructorOptions[])
          : ([{ role: 'close', registerAccelerator: false }] as MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'DockTerm on GitHub',
          click: () => deps.openExternal('https://github.com/munvard/dockterm')
        }
      ]
    }
  ]
}
