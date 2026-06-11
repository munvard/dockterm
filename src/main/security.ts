import { app, BrowserWindow, session, shell } from 'electron'

const EXTERNAL_URL = /^https?:\/\//i

/**
 * Production Content-Security-Policy. No remote origins of any kind.
 * - `'unsafe-eval'` is required by the Monaco editor; it is scoped to our own
 *   `app://` origin only and there is never remote script to abuse it.
 * - `worker-src blob:` is required by Monaco and xterm web workers.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ')

/** Returns true only for frames that belong to our own app (no remote content ever loads). */
export function isTrustedSender(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('app://')) return true
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && url.startsWith(devUrl)) return true
  if (!app.isPackaged && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(url)) return true
  return false
}

/** Per-window hardening: block navigation, deny popups (open trusted links externally). */
export function applyWindowSecurity(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_URL.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

/** Process-wide hardening applied once after `app` is ready. */
export function applyGlobalSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PROD_CSP]
        }
      })
    })
  }

  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedSender(url)) event.preventDefault()
    })
  })
}
