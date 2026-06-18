import { app, BrowserWindow, net } from 'electron'
import { getSettings, applySettingsPatch } from './settingsService'
import type { UpdateAvailable } from '@shared/ipc'

const REPO = 'munvard/dockterm'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const SIX_HOURS = 6 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

function parseVer(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
}

/** True if `latest` is a strictly higher semver than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVer(latest)
  const b = parseVer(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}

interface GhRelease {
  tag_name?: string
  html_url?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
}

async function fetchLatest(): Promise<GhRelease | null> {
  try {
    const res = await net.fetch(LATEST_API, {
      headers: { 'User-Agent': 'DockTerm', Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return null
    return (await res.json()) as GhRelease
  } catch {
    return null // offline / rate-limited / blocked — silently skip
  }
}

function broadcast(payload: UpdateAvailable): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:available', payload)
  }
}

/**
 * Poll GitHub for a newer release. Auto checks respect the auto-check toggle and
 * the user's snooze/skip choices; a manual check ignores those. Returns the
 * update (and broadcasts it) when one is found, else null.
 */
export async function checkForUpdate(manual = false): Promise<UpdateAvailable | null> {
  const u = getSettings().update
  if (!manual && !u.checkAutomatically) return null
  const rel = await fetchLatest()
  if (!rel?.tag_name || rel.draft || rel.prerelease) return null
  const latest = rel.tag_name.replace(/^v/i, '')
  if (!isNewer(latest, app.getVersion())) return null
  if (!manual && (u.dismissedVersion === latest || Date.now() < u.remindAfter)) return null
  const payload: UpdateAvailable = {
    latestVersion: latest,
    releaseUrl: rel.html_url || RELEASES_PAGE,
    notes: (rel.body ?? '').slice(0, 800)
  }
  broadcast(payload)
  return payload
}

/** Start polling: shortly after launch, then every ~6 hours while open. */
export function startUpdateChecker(): void {
  if (timer) return
  setTimeout(() => void checkForUpdate(), 10_000)
  timer = setInterval(() => void checkForUpdate(), SIX_HOURS)
}

export function snoozeUpdate(hours: number): void {
  applySettingsPatch({ update: { ...getSettings().update, remindAfter: Date.now() + hours * 3_600_000 } })
}

export function skipUpdate(version: string): void {
  applySettingsPatch({ update: { ...getSettings().update, dismissedVersion: version } })
}
