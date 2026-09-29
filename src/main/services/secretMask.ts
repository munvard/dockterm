/** Display mask for any secret value. The renderer never receives the value. */
export const MASK = '••••••••'

const SECRET_KEY_RE =
  /(token|secret|key|api[_-]?key|authorization|bearer|password|passwd|credential|cookie|session)/i

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key)
}

/** Common bare-token shapes that are secrets regardless of context: OpenAI
 * (sk-), GitHub (ghp_/gho_/ghu_/ghs_/github_pat_), Slack (xox?-), AWS access
 * keys (AKIA...), and JWTs (eyJ... base64 header). */
const TOKEN_SHAPE_RE =
  /\b(sk-[A-Za-z0-9_-]{10,}|gh[oup]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?)\b/

/** True for a bare value that LOOKS like an embedded secret by shape: a
 * recognized token prefix, or (heuristically) a long, high-entropy,
 * space-free alphanumeric run — the kind of string an API key or webhook
 * path segment takes, that isn't caught by a specific prefix pattern. */
export function looksLikeSecret(value: string): boolean {
  if (TOKEN_SHAPE_RE.test(value)) return true
  if (value.length < 20 || /\s/.test(value)) return false
  if (!/^[A-Za-z0-9_\-+/.=]+$/.test(value)) return false
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return false
  // Crude entropy proxy: a real secret rarely repeats characters much.
  const distinct = new Set(value).size
  return distinct / value.length > 0.35
}

function maskIfSecretShaped(value: string): string {
  return looksLikeSecret(value) ? MASK : value
}

/**
 * Reduce a URL to scheme + host + path — dropping any embedded credentials,
 * query string, and fragment (MCP URLs sometimes carry tokens in the query) —
 * and masking any path segment that itself looks like a secret (e.g. a Slack
 * incoming-webhook URL carries its token as a path segment, not a query key).
 */
export function safeUrl(url: string): string {
  try {
    const u = new URL(url)
    const segments = u.pathname.split('/').map(maskIfSecretShaped)
    const path = u.pathname && u.pathname !== '/' ? segments.join('/') : ''
    return `${u.protocol}//${u.host}${path}`
  } catch {
    return url.replace(/(\/\/)[^/@]*@/, '$1' + MASK + '@')
  }
}

/** Key names of a record (env/headers). Values are never returned. */
export function keysOf(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
}

const HEADER_OR_ENV_FLAG_RE = /^(--header|-h|-e|--env)$/i

/**
 * Render an MCP server's `command` + `args` for display with secrets masked:
 * `--flag=value` and `KEY=VALUE` pairs whose name looks like a secret, the
 * bare value following a secret-carrying flag (`--token`, `--header`, `-e`,
 * `--env`, ...), any bare token-shaped argument, and any embedded URL (via
 * {@link safeUrl}). Values are never logged, stored, or sent anywhere else.
 */
export function maskCommandLine(command: string, args: string[]): string {
  const out: string[] = [command]
  let maskNext = false
  for (const raw of args) {
    if (maskNext) {
      out.push(MASK)
      maskNext = false
      continue
    }
    const eq = raw.indexOf('=')
    if (raw.startsWith('--') && eq > 2) {
      const flag = raw.slice(2, eq)
      const value = raw.slice(eq + 1)
      out.push(`--${flag}=${isSecretKey(flag) ? MASK : maskIfSecretShaped(value)}`)
      continue
    }
    if (eq > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.slice(0, eq))) {
      const key = raw.slice(0, eq)
      const value = raw.slice(eq + 1)
      out.push(`${key}=${isSecretKey(key) ? MASK : maskIfSecretShaped(value)}`)
      continue
    }
    if (/^https?:\/\//i.test(raw)) {
      out.push(safeUrl(raw))
      continue
    }
    if (looksLikeSecret(raw)) {
      out.push(MASK)
      continue
    }
    out.push(raw)
    const flagName = raw.replace(/^--?/, '')
    if (raw.startsWith('-') && (HEADER_OR_ENV_FLAG_RE.test(raw) || isSecretKey(flagName))) {
      maskNext = true
    }
  }
  return out.join(' ')
}
