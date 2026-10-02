import { join, dirname, basename } from 'node:path'
import { readdir, stat, open, readFile } from 'node:fs/promises'
import {
  parseAgentLine,
  reduceActivity,
  feedSubagentLines,
  emptySubTail,
  labelOf,
  type AgentEvent,
  type ReduceOpts,
  type SubMeta,
  type SubTail,
  type SubagentInfo
} from './agentParse'
import type { AgentActivity } from '@shared/types'

/**
 * Reads Claude Code's local files (read-only) and keeps the state the live agent
 * view needs. No electron here, so it can be replayed against real data.
 *
 * Cost control (this runs every second while agents work, on Windows too):
 * - Which sessions to look at comes from `~/.claude/sessions/<pid>.json` (one tiny
 *   file per running Claude Code process: sessionId + cwd), not from walking every
 *   project directory. A slower scan (every LEGACY_MS) only covers Claude Code
 *   builds without that registry and recently created transcripts.
 * - Parent transcripts and agent transcripts are tailed from a saved byte offset.
 *   First sight of a parent reads only its last TAIL_BYTES.
 * - An agent transcript is stat-ed only while it is recent; the directory listing
 *   is re-read only when its mtime changed or something there is still active.
 */

const TAIL_BYTES = 512 * 1024
const MAX_READ_PER_TICK = 2 * 1024 * 1024
const SUB_FULL_COUNT_MAX = 16 * 1024 * 1024
const FRESH_MS = 5 * 60_000
const UNTRACK_MS = 15 * 60_000
const LEGACY_MS = 20_000
const LEGACY_DIR_AGE_MS = 48 * 3_600_000
const SUB_RECHECK_MS = 60_000
const SUB_OLD_MS = 30 * 60_000
const EVENT_TTL_MS = 6 * 3_600_000
const EVENT_CAP = 4000
const CLOSED_KEEP_MS = 15 * 60_000

interface Session {
  id: string
  path: string
  /** from the live registry (process known to be running) vs found by scanning */
  registry: boolean
  offset: number
  firstRead: boolean
  mtimeMs: number
  subDir: string
  subDirMtime: number
  lastTouch: number
}

interface SubState {
  path: string
  sessionId: string
  info: SubagentInfo
  tail: SubTail
  offset: number
  size: number
  lastCheck: number
}

interface RegistryEntry {
  pid: number
  sessionId: string
  cwd: string
  /** Claude Code's own status: 'busy' (a turn, or its agents/teammates run),
   * 'shell' (idle, a background shell runs), 'waiting' (a dialog), 'idle'. */
  status: string | null
  mtimeMs: number
}

/** A running Claude Code process from the sessions registry. */
export interface LiveSession {
  pid: number
  sessionId: string
  status: string | null
}

export interface TrackerPaths {
  projectsDir: string
  sessionsDir: string
}

/** Claude Code's project folder name for a working directory (every non-alphanumeric becomes '-'). */
export function slugOf(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function readBytes(path: string, start: number, end: number): Promise<Buffer> {
  const len = end - start
  if (len <= 0) return Buffer.alloc(0)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, start)
    return bytesRead < len ? buf.subarray(0, bytesRead) : buf
  } finally {
    await fh.close()
  }
}

/** Complete lines of a byte range; the trailing partial line is left for the next read. */
function splitComplete(buf: Buffer, dropHead: boolean): { lines: string[]; used: number } {
  let from = 0
  if (dropHead) {
    const nl = buf.indexOf(10)
    if (nl < 0) return { lines: [], used: buf.length }
    from = nl + 1
  }
  const last = buf.lastIndexOf(10)
  if (last < from) return { lines: [], used: dropHead ? from : 0 }
  const text = buf.subarray(from, last).toString('utf8')
  return { lines: text.length ? text.split('\n') : [], used: last + 1 }
}

export function createAgentTracker(paths: TrackerPaths, clock: () => number = Date.now) {
  let events: AgentEvent[] = []
  const pending = new Set<string>()
  const sessions = new Map<string, Session>()
  const subs = new Map<string, SubState>()
  const registry = new Map<string, RegistryEntry>() // file name to entry
  const aliveSeen = new Set<string>()
  const closed = new Map<string, number>()
  const knownPaths = new Map<string, string>() // sessionId to transcript path (scan)
  let lastLegacy = 0
  let busy = 0
  let live: LiveSession[] = []

  function push(e: AgentEvent): void {
    events.push(e)
    if (e.kind === 'spawn') pending.add(e.id)
    else if (e.kind === 'launch' || e.kind === 'result') pending.delete(e.id)
  }

  async function refreshRegistry(now: number): Promise<void> {
    let names: string[]
    try {
      names = (await readdir(paths.sessionsDir)).filter((n) => n.endsWith('.json'))
    } catch {
      return
    }
    const present = new Set(names)
    for (const n of [...registry.keys()]) if (!present.has(n)) registry.delete(n)
    for (const n of names) {
      const p = join(paths.sessionsDir, n)
      try {
        const st = await stat(p)
        const prev = registry.get(n)
        if (prev && prev.mtimeMs === st.mtimeMs) continue
        const o = JSON.parse(await readFile(p, 'utf8')) as { pid?: number; sessionId?: string; cwd?: string; status?: unknown }
        if (typeof o.sessionId === 'string' && typeof o.pid === 'number') {
          const status = typeof o.status === 'string' ? o.status : null
          registry.set(n, { pid: o.pid, sessionId: o.sessionId, cwd: o.cwd ?? '', status, mtimeMs: st.mtimeMs })
        }
      } catch {
        // half-written or unreadable: look again next tick
      }
    }
    const aliveNow = new Set<string>()
    live = []
    for (const r of registry.values()) {
      if (!pidAlive(r.pid)) continue
      aliveNow.add(r.sessionId)
      live.push({ pid: r.pid, sessionId: r.sessionId, status: r.status })
    }
    for (const id of aliveNow) {
      closed.delete(id)
      aliveSeen.add(id)
    }
    for (const id of [...aliveSeen]) {
      if (!aliveNow.has(id)) {
        aliveSeen.delete(id)
        closed.set(id, now)
        sessions.delete(id)
        for (const [p, x] of subs) if (x.sessionId === id) subs.delete(p)
      }
    }
    for (const r of registry.values()) {
      if (!aliveNow.has(r.sessionId) || sessions.has(r.sessionId)) continue
      let path = join(paths.projectsDir, slugOf(r.cwd), `${r.sessionId}.jsonl`)
      let st = await stat(path).catch(() => null)
      if (!st) {
        const alt = knownPaths.get(r.sessionId)
        if (alt) {
          path = alt
          st = await stat(path).catch(() => null)
        }
      }
      if (!st) continue
      addSession(r.sessionId, path, true, st.mtimeMs, now)
    }
  }

  function addSession(id: string, path: string, reg: boolean, mtimeMs: number, now: number): void {
    const existing = sessions.get(id)
    if (existing) {
      if (reg) existing.registry = true
      return
    }
    sessions.set(id, {
      id,
      path,
      registry: reg,
      offset: 0,
      firstRead: true,
      mtimeMs,
      subDir: join(dirname(path), id, 'subagents'),
      subDirMtime: 0,
      lastTouch: reg ? now : mtimeMs
    })
  }

  /** Slow pass for builds without the registry, and sessions it does not list. */
  async function legacyScan(now: number): Promise<void> {
    let dirs: string[]
    try {
      dirs = await readdir(paths.projectsDir)
    } catch {
      return
    }
    for (const d of dirs) {
      const dir = join(paths.projectsDir, d)
      let files: string[]
      try {
        const st = await stat(dir)
        if (!st.isDirectory() || now - st.mtimeMs > LEGACY_DIR_AGE_MS) continue
        files = await readdir(dir)
      } catch {
        continue
      }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue
        const id = f.slice(0, -6)
        const path = join(dir, f)
        knownPaths.set(id, path)
        if (sessions.has(id) || closed.has(id)) continue
        try {
          const st = await stat(path)
          if (now - st.mtimeMs < FRESH_MS) addSession(id, path, false, st.mtimeMs, now)
        } catch {
          // gone
        }
      }
    }
  }

  async function tailSession(s: Session): Promise<boolean> {
    let st
    try {
      st = await stat(s.path)
    } catch {
      return false
    }
    let changed = false
    s.mtimeMs = st.mtimeMs
    if (s.firstRead) {
      s.firstRead = false
      s.offset = Math.max(0, st.size - TAIL_BYTES)
      const buf = await readBytes(s.path, s.offset, st.size).catch(() => null)
      if (buf) {
        const { lines, used } = splitComplete(buf, s.offset > 0)
        s.offset += used
        for (const l of lines) for (const e of parseAgentLine(l, pending)) (push(e), (changed = true))
      }
      return changed
    }
    if (st.size < s.offset) s.offset = 0
    if (st.size <= s.offset) return false
    let from = s.offset
    let drop = false
    if (st.size - from > MAX_READ_PER_TICK) {
      from = st.size - MAX_READ_PER_TICK
      drop = true
    }
    const buf = await readBytes(s.path, from, st.size).catch(() => null)
    if (!buf) return false
    const { lines, used } = splitComplete(buf, drop)
    s.offset = from + used
    s.lastTouch = clock()
    for (const l of lines) for (const e of parseAgentLine(l, pending)) (push(e), (changed = true))
    return changed
  }

  async function loadMeta(path: string): Promise<{ meta: SubMeta; birth: number }> {
    const mp = path.replace(/\.jsonl$/, '.meta.json')
    try {
      const [raw, st] = await Promise.all([readFile(mp, 'utf8'), stat(mp)])
      return { meta: JSON.parse(raw) as SubMeta, birth: st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs }
    } catch {
      return { meta: {}, birth: 0 }
    }
  }

  async function readSub(sub: SubState, size: number): Promise<void> {
    if (size < sub.offset) {
      sub.offset = 0
      sub.tail = emptySubTail()
    }
    let from = sub.offset
    if (from === 0 && size > SUB_FULL_COUNT_MAX) from = size - 1024 * 1024
    while (from < size) {
      const end = Math.min(size, from + 1024 * 1024)
      const buf = await readBytes(sub.path, from, end).catch(() => null)
      if (!buf || buf.length === 0) break
      const last = buf.lastIndexOf(10)
      if (last < 0) {
        if (end >= size) break // a line still being written
        from = end // one line bigger than a block: skip it (tool output, never a tool_use)
        sub.offset = from
        continue
      }
      feedSubagentLines(sub.tail, buf.subarray(0, last).toString('utf8').split('\n'))
      from += last + 1
      sub.offset = from
    }
    sub.info.steps = sub.tail.steps
    sub.info.action = sub.tail.action
    if (sub.tail.cwd) sub.info.project = sub.tail.cwd
  }

  async function scanSubagents(s: Session, now: number): Promise<boolean> {
    let changed = false
    let dirMtime = 0
    try {
      dirMtime = (await stat(s.subDir)).mtimeMs
    } catch {
      return false
    }
    const anyRecent = [...subs.values()].some((x) => x.sessionId === s.id && now - x.info.lastActiveAt < SUB_OLD_MS)
    if (dirMtime !== s.subDirMtime || anyRecent) {
      s.subDirMtime = dirMtime
      let names: string[] = []
      try {
        names = await readdir(s.subDir)
      } catch {
        names = []
      }
      for (const n of names) {
        if (!n.startsWith('agent-') || !n.endsWith('.jsonl')) continue
        const path = join(s.subDir, n)
        if (!subs.has(path)) {
          const { meta, birth } = await loadMeta(path)
          subs.set(path, {
            path,
            sessionId: s.id,
            tail: emptySubTail(),
            offset: 0,
            size: -1,
            lastCheck: 0,
            info: {
              agentId: basename(n, '.jsonl').slice('agent-'.length),
              sessionId: s.id,
              project: '',
              meta,
              startedAt: birth,
              lastActiveAt: 0,
              steps: 0,
              action: null
            }
          })
        }
      }
    }
    for (const sub of subs.values()) {
      if (sub.sessionId !== s.id) continue
      const old = sub.size >= 0 && now - sub.info.lastActiveAt > SUB_OLD_MS
      if (old && now - sub.lastCheck < SUB_RECHECK_MS) continue
      sub.lastCheck = now
      let st
      try {
        st = await stat(sub.path)
      } catch {
        subs.delete(sub.path)
        changed = true
        continue
      }
      sub.info.lastActiveAt = st.mtimeMs
      if (st.size !== sub.size) {
        // A big agent transcript is read only once it is recent enough to matter.
        if (sub.size < 0 && now - st.mtimeMs > SUB_OLD_MS) {
          sub.size = st.size
          sub.offset = st.size
          continue
        }
        sub.size = st.size
        await readSub(sub, st.size)
        changed = true
      }
    }
    return changed
  }

  async function scanOnce(): Promise<boolean> {
    const now = clock()
    let changed = false
    await refreshRegistry(now)
    if (now - lastLegacy >= LEGACY_MS) {
      lastLegacy = now
      await legacyScan(now)
    }
    for (const s of [...sessions.values()]) {
      if (await tailSession(s)) changed = true
      if (await scanSubagents(s, now)) changed = true
      const stillRunning = [...subs.values()].some((x) => x.sessionId === s.id && now - x.info.lastActiveAt < FRESH_MS)
      if (!s.registry && !stillRunning && now - Math.max(s.mtimeMs, s.lastTouch) > UNTRACK_MS) {
        sessions.delete(s.id)
        for (const [p, x] of subs) if (x.sessionId === s.id) subs.delete(p)
      }
    }
    for (const [id, at] of [...closed]) if (now - at > CLOSED_KEEP_MS) closed.delete(id)
    if (events.length > EVENT_CAP || changed) {
      const cutoff = now - EVENT_TTL_MS
      events = events.filter((e) => e.ts === 0 || e.ts >= cutoff)
      if (events.length > EVENT_CAP) events = events.slice(events.length - EVENT_CAP)
    }
    return changed
  }

  return {
    /** One incremental pass; resolves true when anything new was read. Never overlaps itself. */
    async scan(): Promise<boolean> {
      if (busy) return false
      busy++
      try {
        return await scanOnce()
      } finally {
        busy--
      }
    },
    snapshot(opts: ReduceOpts = {}): AgentActivity {
      const closedSessions = new Map(closed)
      return reduceActivity(events, clock(), { closedSessions, ...opts }, [...subs.values()].map((s) => s.info))
    },
    /** Running Claude Code processes (from the registry), as of the last scan. */
    liveSessions: (): LiveSession[] => live,
    /** How many sessions are being followed (for adaptive polling). */
    sessionCount: (): number => sessions.size,
    projectLabel: labelOf
  }
}

export type AgentTracker = ReturnType<typeof createAgentTracker>
