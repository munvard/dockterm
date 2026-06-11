import os from 'node:os'
import { existsSync } from 'node:fs'
import { spawn, type IPty } from 'node-pty'
import type { BrowserWindow } from 'electron'
import { detectShell } from './shellDetect'
import { PtyFlow } from './ptyFlow'
import { PTY } from '@shared/constants'

interface Session {
  id: string
  pty: IPty
  flow: PtyFlow
  flushTimer: ReturnType<typeof setTimeout> | null
  win: BrowserWindow
}

const sessions = new Map<string, Session>()
let counter = 0

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

export function createPty(args: CreatePtyArgs): { sessionId: string; shell: string } {
  const shell = detectShell()
  const cwd = args.cwd && existsSync(args.cwd) ? args.cwd : os.homedir()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLAUDE_CODE_NO_FLICKER: '1'
  }

  const pty = spawn(shell.file, shell.args, {
    name: 'xterm-256color',
    cols: clamp(args.cols, PTY.MIN_COLS, PTY.MAX_COLS),
    rows: clamp(args.rows, PTY.MIN_ROWS, PTY.MAX_ROWS),
    cwd,
    env
  })

  const id = `pty-${++counter}`
  const session: Session = { id, pty, flow: new PtyFlow(), flushTimer: null, win: args.win }
  sessions.set(id, session)

  pty.onData((data) => {
    if (session.flow.push(data)) flushSession(session)
    else scheduleFlush(session)
  })

  pty.onExit(({ exitCode }) => {
    flushSession(session)
    if (!session.win.isDestroyed()) {
      session.win.webContents.send('pty:exit', { sessionId: id, exitCode })
    }
    disposeSession(id)
  })

  return { sessionId: id, shell: shell.file }
}

function flushSession(session: Session): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  if (!session.flow.hasBuffered) return
  const data = session.flow.drain()
  if (session.win.isDestroyed()) return
  session.win.webContents.send('pty:data', { sessionId: session.id, data })
  if (session.flow.onSent(Buffer.byteLength(data))) {
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

function disposeSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  if (session.flushTimer) clearTimeout(session.flushTimer)
  sessions.delete(id)
}
