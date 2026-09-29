import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Persists each terminal's serialized scrollback so it can be restored (read-only)
 * after a full quit. The live shell/Claude processes die on quit — only the
 * on-screen history comes back; `claude --resume` continues the conversation.
 *
 * Stored in the app's own userData dir (never sent anywhere). The renderer already
 * caps each buffer's scrollback; here we bound the total so the file can't grow
 * without limit.
 */
export interface TerminalBuffer {
  leafId: string
  data: string
}

/** A buffer as stored on disk: namespaced by the project it belongs to (issued
 * by main, see windowNamespace.ts), so windows on different projects can never
 * read or overwrite each other's scrollback by reusing a leafId. */
export interface StoredBuffer extends TerminalBuffer {
  ns: string
}

const MAX_TOTAL_BYTES = 4 * 1024 * 1024

function bufferFile(): string {
  return join(app.getPath('userData'), 'dockterm-terminals.json')
}

/** Keep buffers (in order) until the running total would exceed `maxBytes`. Pure. */
export function capBuffers<T extends TerminalBuffer>(buffers: T[], maxBytes: number): T[] {
  const out: T[] = []
  let total = 0
  for (const b of buffers) {
    total += b.data.length
    if (total > maxBytes) break
    out.push(b)
  }
  return out
}

/** Merge freshly-serialized buffers into whatever is already on disk, by
 * (namespace, leafId). Each window only knows its OWN terminals — a plain
 * overwrite let a secondary window's save wipe out every OTHER window's (e.g.
 * the primary's) scrollback the moment it saved after the primary did, since
 * `terminal:saveBuffers` is called independently by every open window. `fresh`
 * entries win and are ordered first (so `capBuffers`' byte budget evicts the
 * STALEST entries — closed windows/tabs — first, not whichever window saved
 * least recently). Pure. */
export function mergeBuffers(fresh: StoredBuffer[], existing: StoredBuffer[]): StoredBuffer[] {
  const keyOf = (b: StoredBuffer): string => `${b.ns}\0${b.leafId}`
  const freshKeys = new Set(fresh.map(keyOf))
  return [...fresh, ...existing.filter((b) => !freshKeys.has(keyOf(b)))]
}

/** Only the entries of one namespace, without it. Pure. */
export function buffersFor(all: StoredBuffer[], ns: string): TerminalBuffer[] {
  return all.filter((b) => b.ns === ns).map(({ leafId, data }) => ({ leafId, data }))
}

function isStored(b: unknown): b is StoredBuffer {
  const o = b as Partial<StoredBuffer> | null
  return (
    !!o &&
    typeof o.ns === 'string' &&
    o.ns !== '' &&
    typeof o.leafId === 'string' &&
    typeof o.data === 'string'
  )
}

/** Entries written before buffers were namespaced (no `ns`) cannot be attributed
 * to a window, so they are ignored rather than handed to whoever asks first. */
function loadAll(): StoredBuffer[] {
  try {
    const raw = JSON.parse(readFileSync(bufferFile(), 'utf8')) as { buffers?: unknown }
    return Array.isArray(raw.buffers) ? raw.buffers.filter(isStored) : []
  } catch {
    return []
  }
}

export function loadBuffers(ns: string): TerminalBuffer[] {
  return buffersFor(loadAll(), ns)
}

export function saveBuffers(ns: string, buffers: TerminalBuffer[]): void {
  try {
    const fresh = buffers.map((b) => ({ ns, leafId: b.leafId, data: b.data }))
    const merged = mergeBuffers(fresh, loadAll())
    writeFileSync(bufferFile(), JSON.stringify({ buffers: capBuffers(merged, MAX_TOTAL_BYTES) }), 'utf8')
  } catch {
    // best-effort persistence — never block quit on a write error
  }
}
