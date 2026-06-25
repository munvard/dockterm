import { app, BrowserWindow, net, shell } from 'electron'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { getSettings, applySettingsPatch } from './settingsService'
import type { UpdateAvailable } from '@shared/ipc'

const REPO = 'munvard/dockterm'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
const SIX_HOURS = 6 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null
/** The downloadable asset for THIS platform from the latest release, if found. */
let pendingAsset: { url: string; name: string } | null = null
let downloading = false

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

/** Trim the GitHub release body to just the "What's new" section: drop the HTML
 * comment header and everything from the first horizontal rule (the download
 * table + footer), so the popup reads cleanly from the first heading. */
export function cleanNotes(raw: string): string {
  let t = (raw ?? '').replace(/<!--[\s\S]*?-->/g, '')
  const rule = t.search(/\n\s*---/)
  if (rule >= 0) t = t.slice(0, rule)
  t = t.trim()
  if (t.length > 1600) {
    t = t.slice(0, 1600)
    t = t.slice(0, t.lastIndexOf('\n')) + '\n…' // never cut mid-line
  }
  return t
}

interface GhAsset {
  name?: string
  browser_download_url?: string
}
interface GhRelease {
  tag_name?: string
  html_url?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GhAsset[]
}

/** Pick the installer asset matching this OS + arch from a release's assets. */
function pickAsset(assets: GhAsset[]): { url: string; name: string } | null {
  const find = (re: RegExp): { url: string; name: string } | null => {
    for (const a of assets) {
      if (a.name && a.browser_download_url && re.test(a.name)) {
        return { url: a.browser_download_url, name: a.name }
      }
    }
    return null
  }
  if (process.platform === 'win32') return find(/windows.*\.exe$/i) ?? find(/\.exe$/i)
  if (process.platform === 'darwin') {
    return process.arch === 'arm64'
      ? find(/apple-silicon\.dmg$/i) ?? find(/arm64\.dmg$/i) ?? find(/\.dmg$/i)
      : find(/intel\.dmg$/i) ?? find(/x64\.dmg$/i) ?? find(/\.dmg$/i)
  }
  if (process.platform === 'linux') return find(/linux.*\.appimage$/i) ?? find(/\.appimage$/i)
  return null
}

async function fetchLatest(): Promise<GhRelease | null> {
  try {
    const res = await net.fetch(LATEST_API, {
      headers: { 'User-Agent': 'DockTerm', Accept: 'application/vnd.github+json' }
    })
    if (!res.ok) return null
    return (await res.json()) as GhRelease
  } catch {
    return null
  }
}

function send<T>(channel: string, payload: T): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
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
  pendingAsset = pickAsset(rel.assets ?? [])
  const payload: UpdateAvailable = {
    latestVersion: latest,
    releaseUrl: rel.html_url || RELEASES_PAGE,
    notes: cleanNotes(rel.body ?? ''),
    canAutoUpdate: !!pendingAsset
  }
  send('update:available', payload)
  return payload
}

/** Absolute path of the AppImage we're running from, or null if we didn't launch
 * as a real AppImage. The AppImage runtime exports $APPIMAGE (the *.AppImage path)
 * in both FUSE and --appimage-extract-and-run modes; when run extracted or in dev
 * it's unset or points at an AppDir's AppRun, so we require an existing *.AppImage
 * before attempting an in-place self-update. */
export function runningAppImage(env: NodeJS.ProcessEnv = process.env): string | null {
  const p = env.APPIMAGE
  if (p && /\.appimage$/i.test(p) && existsSync(p)) return p
  return null
}

/** Args used to relaunch a Linux AppImage after a self-update. We force
 * --appimage-extract-and-run so the new build boots even on machines without
 * libfuse2 (the only cost is a one-time re-extract on the next launch). */
export function linuxRelaunchArgs(): string[] {
  return ['--appimage-extract-and-run']
}

/** Download the matched installer for this platform (with progress). On macOS/Windows
 * open the installer (.dmg/.exe). On Linux, if we're running as a real AppImage, swap
 * the new build in atomically and relaunch — a true in-app update; otherwise (dev /
 * extracted) fall back to revealing the download. No browser. */
export async function downloadAndInstall(): Promise<void> {
  if (downloading) return
  if (!pendingAsset) {
    send('update:error', { message: 'no-asset' })
    return
  }
  downloading = true

  // On Linux we self-update by atomically replacing the running AppImage, so stream
  // the download into the target's own directory (same filesystem → atomic rename).
  // Everywhere else (and when not running as a real AppImage) download to ~/Downloads.
  const appImage = process.platform === 'linux' ? runningAppImage() : null
  const dest = appImage
    ? join(dirname(appImage), `.${basename(appImage)}.new-${process.pid}`)
    : join(app.getPath('downloads'), pendingAsset.name)

  try {
    const res = await net.fetch(pendingAsset.url, { headers: { 'User-Agent': 'DockTerm' } })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') || 0)
    const out = createWriteStream(dest)
    const reader = res.body.getReader()
    let received = 0
    let lastPct = -1
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.write(Buffer.from(value))
      received += value.length
      if (total) {
        const pct = Math.round((received / total) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          send('update:progress', { percent: pct })
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve())
      out.on('error', reject)
      out.end()
    })

    if (process.platform === 'linux') {
      await chmod(dest, 0o755).catch(() => {}) // AppImages must be executable to run
      if (appImage) {
        // Atomic swap: rename onto the running file. The live process keeps the old
        // inode open until it exits, so this is safe even under a FUSE mount.
        await rename(dest, appImage)
        send('update:downloaded', { path: appImage, relaunching: true })
        app.relaunch({ execPath: appImage, args: linuxRelaunchArgs() })
        setTimeout(() => app.quit(), 800) // let the popup paint "restarting" first
      } else {
        send('update:downloaded', { path: dest }) // dev/extracted: can't self-replace
        shell.showItemInFolder(dest)
      }
    } else {
      send('update:downloaded', { path: dest })
      await shell.openPath(dest) // run the installer (.exe) / mount the .dmg
    }
  } catch (e) {
    if (appImage) await unlink(dest).catch(() => {}) // drop the partial staged temp
    send('update:error', { message: e instanceof Error ? e.message : 'download failed' })
  } finally {
    downloading = false
  }
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
