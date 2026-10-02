import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeConfigDir } from './claudeConfigDir'
import {
  CAPTURE_DELEGATE_FILE,
  CAPTURE_FILE,
  CAPTURE_SCRIPT,
  CAPTURE_SETTINGS,
  CAPTURE_WRAPPER,
  CAPTURE_WRAPPER_SH,
  captureCommand,
  captureSettingsJson,
  nextExpiry,
  nodeOnPath,
  pruneExpired,
  sameRealUsage,
  toRealUsage,
  userStatusLine
} from './usageCaptureCore'
import type { RealUsage } from '@shared/usageReal'
import captureScript from './usageCapture/usage-capture.cjs?raw'

/**
 * Real Claude usage: the exact numbers Claude Code's own status line shows.
 *
 * Claude started in a DockTerm pane gets `--settings <DockTerm-owned JSON>` whose
 * statusLine is usage-capture.cjs. That script saves rate_limits / context / model
 * / cost to one file in userData and then runs the user's own status line, so the
 * status line looks unchanged. This service writes those files (idempotent, never
 * touches anything under ~/.claude) and watches the one capture file with fs.watch:
 * no polling, no transcript reads, no network, no tokens.
 */

const DEBOUNCE_MS = 60

function captureDir(): string {
  return join(app.getPath('userData'), 'usage-capture')
}

function writeIfChanged(file: string, content: string): void {
  try {
    if (readFileSync(file, 'utf8') === content) return
  } catch {
    /* missing: write it */
  }
  writeFileSync(file, content, 'utf8')
}

function readUserStatusLine(): ReturnType<typeof userStatusLine> {
  try {
    return userStatusLine(JSON.parse(readFileSync(join(claudeConfigDir(), 'settings.json'), 'utf8')))
  } catch {
    return null
  }
}

let cachedPath: string | null = null
let cachedAt = 0
const RESYNC_MS = 5_000

/** Write the capture files (idempotent) and return the DockTerm-owned settings
 * file to pass as `claude --settings`, or null when capture cannot work here
 * (Windows without `node` on PATH, an unquotable install path, a read-only
 * userData). Re-checked at most every few seconds, so a changed refreshInterval or
 * status line in the user's settings is picked up for the next terminal. */
export function captureSettingsPath(): string | null {
  const now = Date.now()
  if (now - cachedAt < RESYNC_MS) return cachedPath
  cachedAt = now
  cachedPath = null
  try {
    const platform = process.platform
    const dir = captureDir()
    if (platform === 'win32' && !nodeOnPath(process.env.PATH ?? '', platform, existsSync)) return null
    const command = captureCommand(dir, platform)
    if (!command) return null
    mkdirSync(dir, { recursive: true })
    const user = readUserStatusLine()
    writeIfChanged(join(dir, CAPTURE_SCRIPT), captureScript)
    if (platform !== 'win32') {
      writeIfChanged(join(dir, CAPTURE_WRAPPER), CAPTURE_WRAPPER_SH)
      writeIfChanged(join(dir, CAPTURE_DELEGATE_FILE), user ? user.command + '\n' : '')
    }
    const settings = join(dir, CAPTURE_SETTINGS)
    writeIfChanged(settings, captureSettingsJson(command, user))
    cachedPath = settings
  } catch {
    cachedPath = null
  }
  return cachedPath
}

/* ------------------------------- the live value ------------------------------- */

let current: RealUsage | null = null
let watcher: FSWatcher | null = null
let readTimer: ReturnType<typeof setTimeout> | null = null
let expiryTimer: ReturnType<typeof setTimeout> | null = null

/** The latest real usage, expired windows already dropped. */
export function getRealUsage(): RealUsage | null {
  return pruneExpired(current, Date.now())
}

function broadcast(): void {
  const value = getRealUsage()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('usage:real', value)
  }
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  const at = nextExpiry(current)
  if (at === null) return
  // One timer to the soonest reset: a window ending must not linger on screen.
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    broadcast()
    current = getRealUsage()
    scheduleExpiry()
  }, Math.min(Math.max(at - Date.now() + 500, 500), 2 ** 31 - 1))
}

async function reload(): Promise<void> {
  let next: RealUsage | null = null
  try {
    next = toRealUsage(JSON.parse(await readFile(join(captureDir(), CAPTURE_FILE), 'utf8')), Date.now())
  } catch {
    return // missing or half-written: the next change event retries
  }
  if (sameRealUsage(current, next)) return
  current = next
  scheduleExpiry()
  broadcast()
}

function scheduleReload(): void {
  if (readTimer) return
  readTimer = setTimeout(() => {
    readTimer = null
    void reload()
  }, DEBOUNCE_MS)
}

/** Load the last capture and watch the capture directory (the file is replaced by
 * rename, so the directory is watched, filtered to that one file). */
export function startRealUsageWatcher(): void {
  if (watcher) return
  const dir = captureDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    return
  }
  void reload()
  try {
    watcher = watch(dir, { persistent: false }, (_event, name) => {
      if (!name || name === CAPTURE_FILE) scheduleReload()
    })
    watcher.on('error', () => stopRealUsageWatcher())
  } catch {
    watcher = null
  }
}

export function stopRealUsageWatcher(): void {
  watcher?.close()
  watcher = null
  if (readTimer) clearTimeout(readTimer)
  if (expiryTimer) clearTimeout(expiryTimer)
  readTimer = null
  expiryTimer = null
}
