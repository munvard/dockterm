/**
 * Parse the payload of an `OSC 7` sequence (`ESC ] 7 ; <payload> BEL`) into a
 * local filesystem path. Shells emit `file://<host><path>` on each prompt so the
 * terminal can track the working directory. Returns null for anything we can't
 * confidently turn into a path.
 */
export function parseOsc7(payload: string): string | null {
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

  // Windows drive paths arrive as "/C:/Users/x" → "C:\Users\x".
  if (/^\/[A-Za-z]:/.test(path)) {
    path = path.slice(1).replace(/\//g, '\\')
  }

  return path.length > 0 ? path : null
}
