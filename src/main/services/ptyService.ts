import os from 'node:os'
import { existsSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { execFile } from 'node:child_process'
import { spawn } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { detectShell } from './shellDetect'
import { integrationFor, shellKind } from './shellIntegration'
import { getSettings } from './settingsService'
import { captureSettingsPath } from './usageCaptureService'
import { settingsFlagText } from './usageCaptureCore'
import { ensureUtf8Locale } from './ptyLocale'
import { PtyFlow } from './ptyFlow'
import { PTY } from '@shared/constants'
import { PtyHost, type PtyLike } from './ptyHost'
import ptyHostWorkerPath from './ptyHostWorker?modulePath'

interface Session {
  id: string
  pty: PtyLike
  flow: PtyFlow
  flushTimer: ReturnType<typeof setTimeout> | null
  win: BrowserWindow
  /** webContents id of the owning window (stable even after the window closes). */
  ownerId: number
}

const sessions = new Map<string, Session>()
let counter = 0

// Windows only: ptys live in a worker (see PtyHost). Elsewhere spawning is quick.
let host: PtyHost | null = null
function ptyHost(): PtyHost | null {
  if (process.platform !== 'win32') return null
  host ??= new PtyHost(() => {
    const w = new Worker(ptyHostWorkerPath)
    return {
      postMessage: (m) => w.postMessage(m),
      onMessage: (cb) => w.on('message', cb),
      onDeath: (cb) => {
        w.on('error', cb)
        w.on('exit', cb)
      },
      terminate: () => void w.terminate()
    }
  }, (pid) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  })
  return host
}

/** Boot the pty host early (Windows), so the first terminal doesn't wait for it. */
export function warmPtyHost(): void {
  ptyHost()?.warm()
}

/** At quit: give the pty host a moment to deliver the kills (Windows). */
export function flushPtyHost(): void {
  host?.flush(1000)
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

export interface CreatePtyArgs {
  cols: number
  rows: number
  cwd?: string
  win: BrowserWindow
}

export interface CreatePtyResult {
  sessionId: string
  shell: string
  /** The directory the shell actually started in. */
  cwd: string
  /** True when `args.cwd` was requested but didn't exist, so we fell back to
   * the home directory instead: the caller should tell the user rather than
   * silently pretending the pane opened where it was asked to. */
  cwdFellBack: boolean
  /** `--settings "<file>"` for a launcher to add after `claude` in a shell without
   * the DockTerm `claude` hook; null when the hook adds it, or capture is off. */
  claudeFlag: string | null
}

export function createPty(args: CreatePtyArgs): CreatePtyResult {
  const shell = detectShell()
  const requestedCwd = args.cwd
  const cwdFellBack = !!requestedCwd && !existsSync(requestedCwd)
  const cwd = requestedCwd && !cwdFellBack ? requestedCwd : os.homedir()
  const settings = getSettings()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor'
  }
  // Claude Code rendering. Default is inline: Claude uses the terminal's own
  // scrollback (native-feeling scrolling) and respects its `/tui` setting. Only
  // force the flicker-free fullscreen TUI (alternate screen, its own scroll) when
  // the user opts in — CLAUDE_CODE_NO_FLICKER=1 overrides `/tui` to fullscreen.
  if (settings.terminal.claudeFullscreen) env.CLAUDE_CODE_NO_FLICKER = '1'
  // Finder/Dock-launched macOS apps inherit no locale → multibyte paste mojibake.
  ensureUtf8Locale(env, process.platform)

  // Shell integration: make the shell emit OSC 7 so the dock follows `cd`.
  // Off / unsupported shell → spawn unchanged (dock uses the spawn folder).
  let shellArgs = shell.args
  if (settings.terminal.shellIntegration) {
    const integration = integrationFor(shell.file, shell.args, env)
    if (integration) {
      shellArgs = integration.args
      Object.assign(env, integration.env)
    }
  }

  // Real Claude usage: the shells we integrate define a `claude` function that adds
  // `--settings <DockTerm file>` (it reads DOCKTERM_USAGE_SETTINGS). Other shells get
  // the flag from the launchers instead (claudeFlag). Off, or capture unavailable
  // (see captureSettingsPath): Claude is started untouched.
  delete env.DOCKTERM_USAGE_SETTINGS
  let claudeFlag: string | null = null
  const captureFile = settings.usage.captureEnabled ? captureSettingsPath(settings.usage.captureWithoutStatusLine) : null
  if (captureFile) {
    env.DOCKTERM_USAGE_SETTINGS = captureFile
    const hooked = settings.terminal.shellIntegration && shellKind(shell.file) !== 'other'
    if (!hooked) claudeFlag = settingsFlagText(captureFile, process.platform)
  }

  const spawnOpts = {
    name: 'xterm-256color',
    cols: clamp(args.cols, PTY.MIN_COLS, PTY.MAX_COLS),
    rows: clamp(args.rows, PTY.MIN_ROWS, PTY.MAX_ROWS),
    cwd,
    env,
    // Without this, session.pty.kill() forks a whole extra Node process
    // (conpty_console_list_agent) to enumerate the console process list. With
    // the RunAsNode Electron fuse disabled (our packaged build), that fork just
    // relaunches the Electron binary itself, so a second DockTerm window opens
    // on every close. useConptyDll keeps the process list inside the native addon.
    ...(process.platform === 'win32' ? { useConptyDll: true } : {})
  }
  const pty: PtyLike = ptyHost()?.spawn(shell.file, shellArgs, spawnOpts) ?? spawn(shell.file, shellArgs, spawnOpts)

  const id = `pty-${++counter}`
  const session: Session = {
    id,
    pty,
    flow: new PtyFlow(),
    flushTimer: null,
    win: args.win,
    ownerId: args.win.webContents.id
  }
  sessions.set(id, session)

  pty.onData((data) => {
    const full = session.flow.push(data)
    if (full || (!session.flushTimer && session.flow.isLeadingEdge(Date.now()))) flushSession(session)
    else scheduleFlush(session)
  })

  pty.onExit(({ exitCode }) => {
    flushSession(session)
    if (!session.win.isDestroyed()) {
      session.win.webContents.send('pty:exit', { sessionId: id, exitCode })
    }
    disposeSession(id)
  })

  return { sessionId: id, shell: shell.file, cwd, cwdFellBack, claudeFlag }
}

function flushSession(session: Session): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  if (!session.flow.hasBuffered) return
  const bytes = session.flow.bufferedByteCount
  const data = session.flow.drain()
  if (session.win.isDestroyed()) return
  session.win.webContents.send('pty:data', { sessionId: session.id, data })
  if (session.flow.onSent(bytes)) {
    session.pty.pause()
  }
}

function scheduleFlush(session: Session): void {
  if (session.flushTimer) return
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null
    flushSession(session)
  }, PTY.FLUSH_MS)
}

export function writePty(sessionId: string, data: string): void {
  sessions.get(sessionId)?.pty.write(data)
}

/** The foreground process name of a session's pty ('zsh', 'node', 'claude', …).
 * Empty when the session is gone. Used to warn before closing a busy terminal.
 *
 * On win32, node-pty's `IPty.process` getter (WindowsTerminal.get process) just
 * echoes back `this._name` (the `name` string we passed to `spawn()` at
 * creation, `'xterm-256color'`); it never actually queries the live foreground
 * process there. Reporting that static string as if it were real would make
 * every Windows pane look permanently busy (close always warns, Claude-active
 * checks always true). So win32 reports '' ("unknown") instead, and callers
 * fall back to a buffer-text heuristic (see paneClaudeActive.ts). */
export function foregroundProcess(sessionId: string): string {
  if (process.platform === 'win32') return ''
  return sessions.get(sessionId)?.pty.process ?? ''
}

/** True when `webContentsId` is the window that owns `sessionId`'s pty, or the
 * session no longer exists (nothing to protect: the caller's own no-op
 * handles that case). Guards pty:write/kill/resize/ack so one window (in
 * particular the overlay, which shares the same IPC surface) can't reach into
 * a PTY session it didn't create. */
export function isSessionOwner(sessionId: string, webContentsId: number): boolean {
  const session = sessions.get(sessionId)
  return !session || session.ownerId === webContentsId
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (!session) return
  try {
    session.pty.resize(
      clamp(cols, PTY.MIN_COLS, PTY.MAX_COLS),
      clamp(rows, PTY.MIN_ROWS, PTY.MAX_ROWS)
    )
  } catch {
    // pty may have exited between the renderer measuring and this call; ignore.
  }
}

export function ackPty(sessionId: string, bytes: number): void {
  const session = sessions.get(sessionId)
  if (!session) return
  if (session.flow.onAck(bytes)) session.pty.resume()
}

export function killPty(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (!session) return
  try {
    session.pty.kill()
  } catch {
    // already gone
  }
  disposeSession(sessionId)
}

export function killAllPtys(): void {
  for (const id of [...sessions.keys()]) killPty(id)
}

/** Live ptys with their shell pid (agent activity maps Claude processes to panes). */
export function ptyProcesses(): { id: string; pid: number }[] {
  const out: { id: string; pid: number }[] = []
  for (const s of sessions.values()) {
    const pid = (s.pty as { pid?: number | null }).pid
    if (typeof pid === 'number' && pid > 0) out.push({ id: s.id, pid })
  }
  return out
}

/** How many live PTYs a window owns. */
export function countPtysForWindow(webContentsId: number): number {
  let n = 0
  for (const session of sessions.values()) if (session.ownerId === webContentsId) n++
  return n
}

/** Kill every PTY owned by a window (called when that window closes). */
export function killPtysForWindow(webContentsId: number): void {
  for (const [id, session] of sessions) {
    if (session.ownerId === webContentsId) killPty(id)
  }
}

function disposeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.flushTimer) clearTimeout(session.flushTimer)
  sessions.delete(id)
}
