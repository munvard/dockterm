import { protocol, net } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCHEME = 'app'

/** URL the production window loads. */
export const APP_URL = `${SCHEME}://bundle/index.html`

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
  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url)
    let rel = decodeURIComponent(pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    const filePath = normalize(join(rendererRoot, rel))
    if (filePath !== rendererRoot && !filePath.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}
