/**
 * Parse the payload of an `OSC 7` sequence (`ESC ] 7 ; <payload> BEL`) into a
 * local filesystem path. Shells emit `file://<host><path>` on each prompt so the
 * terminal can track the working directory. Returns null for anything we can't
 * confidently turn into a path. `platform` is the document's data-platform
 * ('win32' converts a doubled leading slash to a UNC path).
 */
export function parseOsc7(payload: string, platform = ''): string | null {
  if (!payload.startsWith('file://')) return null
  const rest = payload.slice('file://'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null // no path component (e.g. "file://host")

  let path = rest.slice(slash) // keep the leading '/'
  try {
    path = decodeURIComponent(path)
  } catch {
    // malformed percent-encoding — fall back to the raw path
  }

  // A UNC path (\\server\share\dir) arrives as "//server/share/dir": the pwsh
  // integration keeps the doubled leading slash to mark it, since the host
  // segment here is our own machine name, not the remote server. Convert every
  // separator to a backslash for the real Windows UNC form.
  // Only on Windows: on macOS/Linux "//usr/bin" is a valid POSIX path.
  if (platform === 'win32' && /^\/\/[^/]+\/[^/]+/.test(path)) {
    return path.replace(/\//g, '\\')
  }

  // Windows drive paths arrive as "/C:/Users/x" → "C:\Users\x".
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1).replace(/\//g, '\\')
    path = path[0].toUpperCase() + path.slice(1)
  }

  return path.length > 0 ? path : null
}
