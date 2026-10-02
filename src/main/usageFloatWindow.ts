import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { applyWindowSecurity } from './security'
import { USAGE_WIDGET_URL } from './protocol'
import { getSettings, applySettingsPatch } from './services/settingsService'
import { broadcastSettings } from './services/settingsBroadcast'
import { registerWindowRole, unregisterWindowRole } from './ipc/windowRoles'
import { FLOAT_MIN_H, FLOAT_MIN_W, clampFloatBounds, sameBox, usageFloatView } from './usageFloatCore'
import type { Box } from './overlayPlacement'

/**
 * The floating usage widget: a small, frameless, interactive window that shows the
 * same real numbers as the pill. Unlike munu's overlay it is NOT click-through and
 * has no canvas: it is an ordinary little window you drag by a CSS drag region and
 * resize by its edges. Its place and size live in settings (usage.float), written
 * debounced after a move or resize and clamped back onto a visible display.
 */
let win: BrowserWindow | null = null
let lastSaved: Box | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let closingForApp = false
let watching = false

const SAVE_DEBOUNCE_MS = 400

const areas = (): Box[] => screen.getAllDisplays().map((d) => d.workArea)
const primaryArea = (): Box => screen.getPrimaryDisplay().workArea

function targetBounds(): Box {
  return clampFloatBounds(getSettings().usage.float, areas(), primaryArea())
}

function applyLevel(on: boolean): void {
  if (!win || win.isDestroyed()) return
  try {
    if (!on) {
      win.setAlwaysOnTop(false)
      if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(false)
      return
    }
    // macOS: the window is an NSPanel (see create), which is what lets this float
    // over another app's fullscreen Space, like munu. Elsewhere a normal top level.
    win.setAlwaysOnTop(true, process.platform === 'darwin' ? 'screen-saver' : 'floating')
    if (process.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    }
  } catch {
    // window may be gone
  }
}

function saveBounds(): void {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  if (lastSaved && sameBox(lastSaved, b)) return
  lastSaved = { x: b.x, y: b.y, width: b.width, height: b.height }
  const next = applySettingsPatch({
    usage: { float: { x: b.x, y: b.y, w: Math.min(1200, b.width), h: Math.min(900, b.height) } }
  })
  broadcastSettings(next)
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveBounds()
  }, SAVE_DEBOUNCE_MS)
}

function onDisplayChange(): void {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const next = clampFloatBounds({ x: b.x, y: b.y, w: b.width, h: b.height }, areas(), primaryArea())
  if (!sameBox(b, next)) win.setBounds(next)
}

function watchDisplays(on: boolean): void {
  if (on === watching) return
  watching = on
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    if (on) screen.on(ev as 'display-added', onDisplayChange)
    else screen.removeListener(ev as 'display-added', onDisplayChange)
  }
}

function create(): void {
  const f = getSettings().usage.float
  const b = targetBounds()
  lastSaved = b
  win = new BrowserWindow({
    ...b,
    minWidth: FLOAT_MIN_W,
    minHeight: FLOAT_MIN_H,
    // macOS: a 'panel' window floats over other apps' fullscreen Space (same as munu).
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    frame: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: true,
    show: false,
    backgroundColor: '#1e1e1d',
    title: 'Claude usage',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  const w = win
  const id = w.webContents.id
  registerWindowRole(id, 'usage')
  applyWindowSecurity(w)
  w.setOpacity(f.opacity)
  applyLevel(f.alwaysOnTop)
  watchDisplays(true)

  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined
  void w.loadURL(devUrl ? `${devUrl}/usage-widget.html` : USAGE_WIDGET_URL)
  w.once('ready-to-show', () => {
    if (!w.isDestroyed()) w.showInactive()
  })
  w.on('move', scheduleSave)
  w.on('resize', scheduleSave)
  w.on('closed', () => {
    unregisterWindowRole(id)
    watchDisplays(false)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (win === w) win = null
    // Closed by the user (Alt+F4) rather than by the app: that means "off".
    if (!closingForApp && getSettings().usage.float.enabled) {
      broadcastSettings(applySettingsPatch({ usage: { float: { enabled: false } } }))
    }
  })
}

/** Make the window match settings: open or close it, and apply level, opacity,
 * place and size. Safe to call often; a window the user is dragging is not moved
 * back, because its own saved bounds are what it compares against. */
export function syncUsageWidget(): void {
  const s = getSettings()
  const f = s.usage.float
  if (!s.usage.enabled || !f.enabled) {
    destroyUsageWidget()
    return
  }
  try {
    if (!win || win.isDestroyed()) {
      closingForApp = false
      create()
      return
    }
    win.setOpacity(f.opacity)
    applyLevel(f.alwaysOnTop)
    const want = targetBounds()
    const fromSettings = { x: f.x, y: f.y, width: f.w, height: f.h }
    const changedOutside =
      !lastSaved || f.x === null || f.y === null || !sameBox(fromSettings as Box, lastSaved)
    if (changedOutside && !sameBox(win.getBounds(), want)) {
      lastSaved = want
      win.setBounds(want)
    }
    win.webContents.send('usageFloat:changed', usageFloatView(s))
  } catch {
    // an optional surface must never break the app
  }
}

export function getUsageWidget(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

/** Close the window without changing the saved "enabled" choice. */
export function destroyUsageWidget(): void {
  if (!win || win.isDestroyed()) {
    win = null
    return
  }
  closingForApp = true
  win.destroy()
  win = null
}

app.on('before-quit', () => {
  closingForApp = true
})
