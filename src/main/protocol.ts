import { protocol, net } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROD_CSP } from './security'

const SCHEME = 'app'

/** URL the production window loads. */
export const APP_URL = `${SCHEME}://bundle/index.html`

/** URL the production munu overlay window loads. Its own host on purpose:
 * Chromium keeps page zoom per scheme and host, so on `bundle` the overlay
 * inherited the main window's UI zoom (110 percent by default) and munu was
 * drawn 10 percent away from where main hit-tests it. */
export const OVERLAY_URL = `${SCHEME}://overlay/overlay.html`

/** URL the production floating usage window loads. */
export const USAGE_WIDGET_URL = `${SCHEME}://bundle/usage-widget.html`

/**
 * Must run before `app` is ready. Registers `app://` as a standard, secure scheme
 * so the renderer behaves like an https origin (enables CSP, fetch, workers) while
 * never touching the privileged `file://` scheme.
 */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
  ])
}

/**
 * Serves the bundled renderer from `out/renderer`, with a hard guard against any
 * path escaping that directory.
 */
export function serveAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    let rel = decodeURIComponent(pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const filePath = normalize(join(rendererRoot, rel))
    if (filePath !== rendererRoot && !filePath.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    const res = await net.fetch(pathToFileURL(filePath).toString())
    // security.ts's onHeadersReceived CSP is a webRequest-layer hook; it isn't
    // guaranteed to run for every response a custom protocol.handle() serves
    // (e.g. the very first document load), so set the same policy directly
    // here too — belt and suspenders for the one scheme that's ever loaded.
    const headers = new Headers(res.headers)
    headers.set('Content-Security-Policy', PROD_CSP)
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}
