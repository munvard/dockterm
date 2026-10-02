import type { RealUsage, RealUsageWindow } from '@shared/usageReal'

/**
 * Pure logic for the real-usage capture (no electron, no fs): turning the capture
 * file into a RealUsage, building the DockTerm-owned Claude settings file, and the
 * `--settings` flag text. The capture script itself is usageCapture/usage-capture.cjs.
 */

export const CAPTURE_FILE = 'claude-usage.json'
export const CAPTURE_SCRIPT = 'usage-capture.cjs'
export const CAPTURE_WRAPPER = 'usage-capture.sh'
export const CAPTURE_DELEGATE_FILE = 'usage-delegate.txt'
export const CAPTURE_SETTINGS = 'claude-settings.json'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function toWindow(raw: unknown, nowMs: number): RealUsageWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as { pct?: unknown; resetsAt?: unknown }
  if (!isNum(w.pct) || !isNum(w.resetsAt)) return null
  const resetsAt = w.resetsAt * 1000 // the capture file keeps Claude's epoch seconds
  if (resetsAt <= nowMs) return null // already reset: Claude drops it, so do we
  return { pct: Math.max(0, w.pct), resetsAt }
}

/** The capture file's JSON → RealUsage. Null when it is not a capture file of the
 * format we know. Expired windows are dropped; nothing is ever filled in. */
export function toRealUsage(raw: unknown, nowMs: number): RealUsage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || !isNum(r.updatedAt)) return null
  const ctx = r.context as { pct?: unknown } | null | undefined
  const model = r.model as { name?: unknown; id?: unknown } | null | undefined
  const name =
    model && typeof model.name === 'string' && model.name
      ? model.name
      : model && typeof model.id === 'string' && model.id
        ? model.id
        : null
  return {
    fiveHour: toWindow(r.fiveHour, nowMs),
    sevenDay: toWindow(r.sevenDay, nowMs),
    updatedAt: isNum(r.limitsAt) ? r.limitsAt : null,
    capturedAt: r.updatedAt,
    contextPct: ctx && isNum(ctx.pct) ? ctx.pct : null,
    model: name,
    costUsd: isNum(r.costUsd) ? r.costUsd : null
  }
}

/** Epoch ms of the soonest window reset, to schedule one re-evaluation. */
export function nextExpiry(real: RealUsage | null): number | null {
  if (!real) return null
  const times = [real.fiveHour?.resetsAt, real.sevenDay?.resetsAt].filter(isNum)
  return times.length ? Math.min(...times) : null
}

/** Same data, with any window whose reset time has passed dropped. */
export function pruneExpired(real: RealUsage | null, nowMs: number): RealUsage | null {
  if (!real) return real
  const live = (w: RealUsageWindow | null): RealUsageWindow | null =>
    w && w.resetsAt > nowMs ? w : null
  const fiveHour = live(real.fiveHour)
  const sevenDay = live(real.sevenDay)
  if (fiveHour === real.fiveHour && sevenDay === real.sevenDay) return real
  return { ...real, fiveHour, sevenDay }
}

/** Value equality for broadcast de-duplication. */
export function sameRealUsage(a: RealUsage | null, b: RealUsage | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const w = (x: RealUsageWindow | null, y: RealUsageWindow | null): boolean =>
    x === y || (!!x && !!y && x.pct === y.pct && x.resetsAt === y.resetsAt)
  return (
    w(a.fiveHour, b.fiveHour) &&
    w(a.sevenDay, b.sevenDay) &&
    a.updatedAt === b.updatedAt &&
    a.contextPct === b.contextPct &&
    a.model === b.model &&
    a.costUsd === b.costUsd
  )
}

/* ---------------------- the DockTerm-owned Claude settings ---------------------- */

export interface UserStatusLine {
  command: string
  padding: number | null
  refreshInterval: number | null
}

/** The status line a Claude settings.json defines, or null. */
export function userStatusLine(settings: unknown): UserStatusLine | null {
  if (!settings || typeof settings !== 'object') return null
  const s = (settings as { statusLine?: unknown }).statusLine
  if (!s || typeof s !== 'object') return null
  const sl = s as { type?: unknown; command?: unknown; padding?: unknown; refreshInterval?: unknown }
  if (sl.type !== 'command' || typeof sl.command !== 'string' || !sl.command.trim()) return null
  return {
    command: sl.command,
    padding: isNum(sl.padding) && sl.padding >= 0 ? Math.floor(sl.padding) : null,
    refreshInterval: isNum(sl.refreshInterval) && sl.refreshInterval >= 1 ? Math.floor(sl.refreshInterval) : null
  }
}

/** The path as it must appear inside double quotes of the status line command.
 * Null when it holds a character that cannot be quoted the same way in every
 * shell Claude may use (Git Bash and PowerShell on Windows). */
function quoteInDoubles(p: string, platform: NodeJS.Platform): string | null {
  if (platform === 'win32') {
    const fwd = p.replace(/\\/g, '/')
    return /["`$%]/.test(fwd) ? null : fwd
  }
  return p.replace(/(["\\$`])/g, '\\$1')
}

/** The command Claude runs as the status line. Posix: a tiny sh wrapper that uses
 * `node` when it is on PATH and otherwise just runs the user's own status line.
 * Windows: `node` directly (null when the path is unquotable). The directory is
 * where the capture files live. */
export function captureCommand(dir: string, platform: NodeJS.Platform): string | null {
  const sep = platform === 'win32' ? '\\' : '/'
  const base = dir.endsWith(sep) || dir.endsWith('/') ? dir : dir + sep
  if (platform === 'win32') {
    const q = quoteInDoubles(base + CAPTURE_SCRIPT, platform)
    return q ? `node "${q}"` : null
  }
  const q = quoteInDoubles(base + CAPTURE_WRAPPER, platform)
  return q ? `sh "${q}"` : null
}

/** Text of the DockTerm-owned settings file given to `claude --settings`. It only
 * sets `statusLine`; padding and refreshInterval follow the user's own status line
 * so its look and cadence do not change. */
export function captureSettingsJson(command: string, user: UserStatusLine | null): string {
  const statusLine: Record<string, unknown> = { type: 'command', command }
  if (user?.padding != null) statusLine.padding = user.padding
  if (user?.refreshInterval != null) statusLine.refreshInterval = user.refreshInterval
  return JSON.stringify({ statusLine }, null, 2) + '\n'
}

/** The POSIX wrapper: node when available, else the user's own status line (its
 * command is saved by DockTerm next to it), else print nothing. */
export const CAPTURE_WRAPPER_SH = `#!/bin/sh
# DockTerm usage capture launcher (auto-generated)
d=$(dirname "$0")
if command -v node >/dev/null 2>&1; then exec node "$d/${CAPTURE_SCRIPT}"; fi
f="$d/${CAPTURE_DELEGATE_FILE}"
if [ -s "$f" ]; then exec sh -c "$(cat "$f")"; fi
cat >/dev/null
`

/** Whether a Windows PATH value holds a `node` executable. Pure over `exists`. */
export function nodeOnPath(
  pathEnv: string,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean
): boolean {
  const sep = platform === 'win32' ? ';' : ':'
  const names = platform === 'win32' ? ['node.exe', 'node.cmd'] : ['node']
  const join = (d: string, n: string): string => (d.endsWith('/') || d.endsWith('\\') ? d + n : d + (platform === 'win32' ? '\\' : '/') + n)
  for (const d of pathEnv.split(sep)) {
    if (!d) continue
    for (const n of names) if (exists(join(d.replace(/^"|"$/g, ''), n))) return true
  }
  return false
}

/* ------------------------------ launching Claude ------------------------------ */

/** `--settings <path>` as text to type into a shell that has no DockTerm `claude`
 * hook (cmd, fish, …): double quotes on Windows, single quotes elsewhere. */
export function settingsFlagText(settingsPath: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `--settings "${settingsPath}"`
  return `--settings '${settingsPath.replace(/'/g, `'\\''`)}'`
}
