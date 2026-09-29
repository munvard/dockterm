import { app, BrowserWindow, net, shell } from 'electron'
import { createWriteStream, createReadStream, existsSync } from 'node:fs'
import { chmod, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { getSettings, applySettingsPatch } from './settingsService'
import type { UpdateAvailable } from '@shared/ipc'

const REPO = 'munvard/dockterm'
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`
// Every asset we ever download must come from exactly this release-asset
// path on GitHub — pinned so a tampered/compromised API response can't point
// the "new version" download at an attacker-controlled host.
const RELEASE_ASSET_PREFIX = `https://github.com/${REPO}/releases/download/`
const SIX_HOURS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000 // installers can be 100+MB on a slow link

let timer: ReturnType<typeof setInterval> | null = null

/** Everything a download needs, captured together when a release is found so a
 * later poll (which replaces this object) can never mix one release's asset with
 * another's checksum while a download is in flight. */
interface PendingUpdate {
  asset: { url: string; name: string }
  /** Expected sha512 (base64) of `asset`, from the release's update-info file.
   * null when it is missing or malformed: the update then cannot be automatic. */
  sha512: string | null
  releaseUrl: string
}
let pending: PendingUpdate | null = null
let downloading = false

function isTrustedAssetUrl(url: string): boolean {
  return url.startsWith(RELEASE_ASSET_PREFIX)
}

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

export interface GhAsset {
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

/** Pick the installer asset matching this OS + arch from a release's assets.
 * Only ever returns an asset hosted under the pinned GitHub releases path. */
export function pickAsset(assets: GhAsset[]): { url: string; name: string } | null {
  const find = (re: RegExp): { url: string; name: string } | null => {
    for (const a of assets) {
      if (a.name && a.browser_download_url && re.test(a.name) && isTrustedAssetUrl(a.browser_download_url)) {
        return { url: a.browser_download_url, name: basename(a.name) }
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

/**
 * Minimal parser for electron-builder's generated `latest*.yml` update-info
 * files — a flat `files: [{url, sha512, size}, ...]` list plus a top-level
 * `path`/`sha512` pair. Hand-rolled (rather than pulling in a YAML library
 * that isn't a declared dependency of this project) since the format is
 * machine-generated and stable: no anchors, multi-line strings, or other
 * general-YAML features ever appear in it. Returns a map of `url -> sha512`.
 */
export function parseUpdateYmlShaByUrl(yml: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = yml.split(/\r?\n/)
  let inFiles = false
  let curUrl: string | null = null
  const unquote = (s: string): string => s.trim().replace(/^['"]|['"]$/g, '')
  for (const line of lines) {
    if (/^files:\s*$/.test(line)) {
      inFiles = true
      curUrl = null
      continue
    }
    if (!inFiles) continue
    // A new top-level (non-indented, non-list-item) key ends the files: block.
    if (/^\S/.test(line)) {
      inFiles = false
      continue
    }
    const urlMatch = line.match(/^\s*-?\s*url:\s*(.+)$/)
    if (urlMatch) {
      curUrl = unquote(urlMatch[1])
      continue
    }
    const shaMatch = line.match(/^\s*sha512:\s*(.+)$/)
    if (shaMatch && curUrl) {
      out.set(curUrl, unquote(shaMatch[1]))
      curUrl = null
    }
  }
  // Single-asset releases (or older electron-builder output) also carry a
  // top-level path/sha512 pair outside the files: list.
  const pathMatch = yml.match(/^path:\s*(.+)$/m)
  const topSha = yml.match(/^sha512:\s*(.+)$/m)
  if (pathMatch && topSha) {
    const p = unquote(pathMatch[1])
    if (!out.has(p)) out.set(p, unquote(topSha[1]))
  }
  return out
}

/** A sha512 as electron-builder writes it: base64 of 64 bytes (86 chars + "=="). */
export function isValidSha512(s: string | null | undefined): s is string {
  return typeof s === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(s)
}

/** Which release asset holds this platform's checksums. macOS has one file PER
 * ARCH (written by the mac CI jobs, see scripts/write-update-info.mjs) because
 * electron-builder's single latest-mac.yml would be raced by the two parallel
 * mac jobs, each holding one architecture. */
export function updateInfoAssetName(platform: string, arch: string): string | null {
  if (platform === 'win32') return 'latest.yml'
  if (platform === 'darwin') return arch === 'arm64' ? 'latest-mac-arm64.yml' : 'latest-mac-x64.yml'
  if (platform === 'linux') return 'latest-linux.yml'
  return null
}

/** Matches this platform+arch's ORIGINAL (pre-friendly-rename) artifact name
 * inside the update-info file — its url/path fields are never touched by the
 * release workflow's later cosmetic asset rename, so matching by the stable
 * build-time name is what actually lines up. */
export function originalNamePattern(platform: string, arch: string): RegExp {
  if (platform === 'darwin') return arch === 'arm64' ? /arm64\.dmg$/i : /x64\.dmg$/i
  if (platform === 'win32') return /\.exe$/i
  return /\.appimage$/i
}

/** The top-level `version:` of an update-info file. */
export function parseUpdateYmlVersion(yml: string): string | null {
  const m = yml.match(/^version:\s*(.+)$/m)
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null
}

/**
 * The expected sha512 for this platform+arch, or null when it cannot be
 * established. Fails closed: null for a manifest of another version, for no
 * matching file, for several matching files that disagree, and for any value
 * that is not a well-formed sha512.
 */
export function resolveExpectedSha512(
  yml: string,
  opts: { platform: string; arch: string; version: string }
): string | null {
  if (parseUpdateYmlVersion(yml) !== opts.version) return null
  const pattern = originalNamePattern(opts.platform, opts.arch)
  const found = new Set<string>()
  for (const [url, sha] of parseUpdateYmlShaByUrl(yml)) {
    if (pattern.test(url)) found.add(sha)
  }
  if (found.size !== 1) return null
  const [sha] = found
  return isValidSha512(sha) ? sha : null
}

/** A release page URL we are willing to open: only this repository's own. */
export function safeReleaseUrl(url: string | undefined): string {
  return url && url.startsWith(`https://github.com/${REPO}/`) ? url : RELEASES_PAGE
}

/**
 * Fetch this platform's update-info file and resolve the expected sha512 for
 * the asset we're about to offer. Returns null on ANY failure or malformed
 * content: without a verifiable checksum the update is NOT automatic (the user
 * is sent to the release page to download it by hand), never "download and
 * run it anyway".
 */
async function fetchExpectedSha512(assets: GhAsset[], version: string): Promise<string | null> {
  const ymlName = updateInfoAssetName(process.platform, process.arch)
  if (!ymlName) return null
  const ymlAsset = assets.find((a) => a.name === ymlName)
  if (!ymlAsset?.browser_download_url || !isTrustedAssetUrl(ymlAsset.browser_download_url)) return null
  try {
    const res = await net.fetch(ymlAsset.browser_download_url, {
      headers: { 'User-Agent': 'DockTerm' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!res.ok) return null
    return resolveExpectedSha512(await res.text(), {
      platform: process.platform,
      arch: process.arch,
      version
    })
  } catch {
    return null
  }
}

async function sha512OfFile(path: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('base64')
}

async function fetchLatest(): Promise<GhRelease | null> {
  try {
    const res = await net.fetch(LATEST_API, {
      headers: { 'User-Agent': 'DockTerm', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
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
  const asset = pickAsset(rel.assets ?? [])
  const sha512 = asset ? await fetchExpectedSha512(rel.assets ?? [], latest) : null
  const releaseUrl = safeReleaseUrl(rel.html_url)
  pending = asset ? { asset, sha512, releaseUrl } : null
  const payload: UpdateAvailable = {
    latestVersion: latest,
    releaseUrl,
    notes: cleanNotes(rel.body ?? ''),
    // No verifiable checksum = no automatic update: the popup sends the user to
    // the release page instead.
    canAutoUpdate: !!pending && isValidSha512(pending.sha512)
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
  // Snapshot asset + checksum + release page together: a poll that finds another
  // release while this one downloads replaces `pending` but not this copy.
  const snap = pending
  if (!snap) {
    send('update:error', { message: 'no-asset' })
    return
  }
  if (!isValidSha512(snap.sha512)) {
    // Fail closed: nothing is downloaded or run without a checksum to verify it
    // against. Hand the user the release page instead.
    void shell.openExternal(snap.releaseUrl)
    send('update:error', { message: 'no-checksum' })
    return
  }
  const expectedSha512 = snap.sha512
  const asset = snap.asset
  if (!isTrustedAssetUrl(asset.url)) {
    // Defense in depth: the asset only ever comes from pickAsset, which
    // already checks this, but never stream a download to an unpinned host.
    send('update:error', { message: 'untrusted download URL' })
    return
  }
  downloading = true

  // On Linux we self-update by atomically replacing the running AppImage, so stream
  // the download into the target's own directory (same filesystem → atomic rename).
  // Everywhere else (and when not running as a real AppImage) download to ~/Downloads.
  const appImage = process.platform === 'linux' ? runningAppImage() : null
  const dest = appImage
    ? join(dirname(appImage), `.${basename(appImage)}.new-${process.pid}`)
    : join(app.getPath('downloads'), asset.name)

  try {
    const res = await net.fetch(asset.url, {
      headers: { 'User-Agent': 'DockTerm' },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const total = Number(res.headers.get('content-length') || 0)
    let received = 0
    let lastPct = -1
    // Readable.fromWeb + stream/promises pipeline (vs. a manual reader loop +
    // a WriteStream whose 'error' listener was only attached after writing
    // started) properly propagates a failure from either side and always
    // cleans up both streams — a write error can no longer be dropped/hang.
    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total) {
        const pct = Math.round((received / total) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          send('update:progress', { percent: pct })
        }
      }
    })
    await pipeline(source, createWriteStream(dest))

    const actual = await sha512OfFile(dest)
    if (actual !== expectedSha512) {
      await unlink(dest).catch(() => {})
      send('update:error', { message: 'integrity check failed' })
      return
    }

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
