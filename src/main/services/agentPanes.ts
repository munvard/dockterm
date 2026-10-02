import { execFile } from 'node:child_process'
import type { LiveAgent } from '@shared/types'
import type { LiveSession } from './agentTracker'

/**
 * Which DockTerm pane each running Claude Code process lives in, and which panes
 * still have work in flight (Claude's turn, or its agents and teammates).
 *
 * A Claude process is attributed to a pane by walking its parent chain up to a
 * pty's shell pid (`claude` is a child of the pane's shell, sometimes through a
 * wrapper). The process table is read only when a Claude pid shows up that is not
 * attributed yet, so the cost is one `ps` (or one PowerShell CIM query on Windows)
 * per new Claude session, not per tick.
 */

export interface PtyProc {
  /** DockTerm's pty session id ('pty-3'). */
  id: string
  /** the pty's shell pid */
  pid: number
}

const MAX_DEPTH = 32

/** The pty whose shell is `pid` or one of its ancestors, or null. */
export function ptyForPid(
  pid: number,
  parentOf: ReadonlyMap<number, number>,
  ptyByPid: ReadonlyMap<number, string>
): string | null {
  let cur = pid
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hit = ptyByPid.get(cur)
    if (hit) return hit
    const up = parentOf.get(cur)
    if (up === undefined || up === cur || up <= 0) return null
    cur = up
  }
  return null
}

/** `pid ppid` lines (ps, or the PowerShell query below) into a parent map. */
export function parseProcessTable(text: string): Map<number, number> {
  const out = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line)
    if (m) out.set(Number(m[1]), Number(m[2]))
  }
  return out
}

export interface PaneWork {
  /** pty ids whose Claude is busy: its turn runs, or agents/teammates it started still run. */
  busyPtys: string[]
  /** running agents of Claude sessions not placed yet (or the lookup failed): one of
   * them may belong to a pane, so they hold back a done smile */
  unattributedRunning: number
  /** running agents of Claude sessions known to run outside every pane */
  outsideRunning: number
}

/**
 * The per-pane work rule. A session is busy when Claude Code itself says so in its
 * registry entry ('busy' covers its turn plus running sub-agents, background agents,
 * non-idle teammates and workflows) or when the transcripts show a running agent of
 * it. A background shell alone ('shell') does not count: dev servers and watchers
 * run that way for hours. `owner(pid)` is the pane's pty id, null when the process
 * is not in any pane, undefined when that is not known (yet).
 */
export function paneWork(
  sessions: readonly LiveSession[],
  owner: (pid: number) => string | null | undefined,
  agents: readonly LiveAgent[]
): PaneWork {
  const ptyOf = new Map<string, string>()
  const busy = new Set<string>()
  for (const s of sessions) {
    const pty = owner(s.pid)
    if (!pty) continue
    ptyOf.set(s.sessionId, pty)
    if (s.status === 'busy') busy.add(pty)
  }
  const outside = new Set(sessions.filter((s) => owner(s.pid) === null).map((s) => s.sessionId))
  let unattributedRunning = 0
  let outsideRunning = 0
  for (const a of agents) {
    if (a.phase !== 'running') continue
    const pty = ptyOf.get(a.sessionId)
    if (pty) busy.add(pty)
    else if (outside.has(a.sessionId)) outsideRunning++
    else unattributedRunning++
  }
  return { busyPtys: [...busy].sort(), unattributedRunning, outsideRunning }
}

export type ProcessTableReader = () => Promise<Map<number, number>>

const run = (file: string, args: string[], timeout: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout)
    )
  })

/** The OS process table as pid to parent pid. */
export function processTableReader(platform: NodeJS.Platform = process.platform): ProcessTableReader {
  if (platform === 'win32') {
    const ps =
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
    return async () => parseProcessTable(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 20_000))
  }
  return async () => parseProcessTable(await run('ps', ['-A', '-o', 'pid=,ppid='], 5_000))
}

/**
 * Caches pid to pane. A Claude process never changes parents, so an answer (pane
 * or none) is kept until the pid leaves the registry; only new pids trigger a
 * process-table read, at most once per `minGapMs`. `refresh` resolves true when it
 * learned something new; callers need not wait for it (the read is a child process).
 */
export function createPidOwner(
  readTable: ProcessTableReader,
  ptys: () => PtyProc[],
  minGapMs: number,
  clock: () => number = Date.now
) {
  const known = new Map<number, string | null>()
  let lastRead = -Infinity
  let reading: Promise<void> | null = null

  async function refresh(pids: readonly number[]): Promise<boolean> {
    const want = new Set(pids)
    for (const p of [...known.keys()]) if (!want.has(p)) known.delete(p)
    const live = ptys()
    const liveIds = new Set(live.map((p) => p.id))
    for (const [p, pty] of known) if (pty && !liveIds.has(pty)) known.delete(p)
    const missing = pids.filter((p) => !known.has(p))
    if (missing.length === 0 || live.length === 0 || reading || clock() - lastRead < minGapMs) return false
    lastRead = clock()
    let learned = false
    reading = (async () => {
      try {
        const table = await readTable()
        const byPid = new Map(ptys().map((p) => [p.pid, p.id]))
        // a pid missing from a table read after it registered has exited: not in a pane
        for (const p of missing) known.set(p, table.has(p) ? ptyForPid(p, table, byPid) : null)
        learned = true
      } catch {
        // unknown for now: those sessions count as unplaced until a later read works
      } finally {
        reading = null
      }
    })()
    await reading
    return learned
  }

  return {
    refresh,
    owner: (pid: number): string | null | undefined => known.get(pid)
  }
}
