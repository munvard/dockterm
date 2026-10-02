import type { PtyDataEvent } from '@shared/ipc'

/**
 * One `pty:data` / `pty:exit` subscription for the whole window, routed by session
 * id. Before this every pane subscribed on its own, so each chunk from any shell was
 * copied across the context bridge once per open pane and dropped by all but one.
 * A pane whose shell is still spawning (no session id yet) waits and sees the
 * unclaimed chunks, exactly as before, so nothing that races the spawn is lost.
 */
export interface PtyRoute {
  data(data: string): void
  exit(exitCode: number): void
}

export class PtyRouter {
  private readonly routes = new Map<string, PtyRoute>()
  private readonly waiting = new Set<(e: PtyDataEvent) => void>()

  dispatchData(e: PtyDataEvent): void {
    const route = this.routes.get(e.sessionId)
    if (route) route.data(e.data)
    else for (const w of this.waiting) w(e)
  }

  dispatchExit(e: { sessionId: string; exitCode: number }): void {
    this.routes.get(e.sessionId)?.exit(e.exitCode)
  }

  /** Receive unclaimed chunks until the returned function is called. */
  wait(fn: (e: PtyDataEvent) => void): () => void {
    this.waiting.add(fn)
    return () => void this.waiting.delete(fn)
  }

  /** Route one session's chunks and exit to `route` until the returned function is called. */
  claim(sessionId: string, route: PtyRoute): () => void {
    this.routes.set(sessionId, route)
    return () => {
      if (this.routes.get(sessionId) === route) this.routes.delete(sessionId)
    }
  }
}

/** Bytes the main process counts for a string (Buffer.byteLength, UTF-8), without
 * allocating an encoded copy per chunk. Lone surrogates count as U+FFFD (3 bytes). */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

/**
 * Coalesces flow-control acks: every write xterm finishes parsing in one task adds
 * to a per-session count that goes out as a single `pty:ack` on the next macrotask,
 * instead of one IPC round trip per chunk. Nothing is held longer than that, so the
 * main process's pause/resume watermarks see the same numbers as before.
 */
export class AckBatcher {
  private readonly pending = new Map<string, number>()
  private scheduled = false

  constructor(
    private readonly send: (sessionId: string, bytes: number) => void,
    private readonly later: (fn: () => void) => void
  ) {}

  add(sessionId: string, bytes: number): void {
    if (bytes <= 0) return
    this.pending.set(sessionId, (this.pending.get(sessionId) ?? 0) + bytes)
    if (this.scheduled) return
    this.scheduled = true
    this.later(() => this.flush())
  }

  flush(): void {
    this.scheduled = false
    const all = [...this.pending]
    this.pending.clear()
    for (const [sid, bytes] of all) this.send(sid, bytes)
  }

  /** Forget a session's unsent acks (its PTY is gone). */
  drop(sessionId: string): void {
    this.pending.delete(sessionId)
  }
}

let router: PtyRouter | null = null
let acks: AckBatcher | null = null

/** The window's router, subscribed to main on first use. */
export function ptyRouter(): PtyRouter {
  if (router) return router
  const r = new PtyRouter()
  router = r
  window.dockterm.on('pty:data', (e) => r.dispatchData(e))
  window.dockterm.on('pty:exit', (e) => r.dispatchExit(e))
  return r
}

export function ptyAcks(): AckBatcher {
  if (acks) return acks
  acks = new AckBatcher(
    (sessionId, bytes) => void window.dockterm.invoke('pty:ack', { sessionId, bytes }),
    (fn) => void setTimeout(fn, 0)
  )
  return acks
}
