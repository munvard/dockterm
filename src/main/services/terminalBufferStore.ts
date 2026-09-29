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

const MAX_TOTAL_BYTES = 4 * 1024 * 1024

function bufferFile(): string {
  return join(app.getPath('userData'), 'dockterm-terminals.json')
}

/** Keep buffers (in order) until the running total would exceed `maxBytes`. Pure. */
export function capBuffers(buffers: TerminalBuffer[], maxBytes: number): TerminalBuffer[] {
  const out: TerminalBuffer[] = []
  let total = 0
  for (const b of buffers) {
    total += b.data.length
    if (total > maxBytes) break
    out.push(b)
  }
  return out
}

/** Merge a window's freshly-serialized buffers into whatever is already on
 * disk, by leafId. Each window only knows its OWN terminals — a plain
 * overwrite let a secondary window's save wipe out every OTHER window's (e.g.
 * the primary's) scrollback the moment it saved after the primary did, since
 * `terminal:saveBuffers` is called independently by every open window. `fresh`
 * entries win and are ordered first (so `capBuffers`' byte budget evicts the
 * STALEST entries — closed windows/tabs — first, not whichever window saved
 * least recently). Pure. */
export function mergeBuffers(fresh: TerminalBuffer[], existing: TerminalBuffer[]): TerminalBuffer[] {
  const freshIds = new Set(fresh.map((b) => b.leafId))
  return [...fresh, ...existing.filter((b) => !freshIds.has(b.leafId))]
}

export function loadBuffers(): TerminalBuffer[] {
  try {
    const raw = JSON.parse(readFileSync(bufferFile(), 'utf8')) as { buffers?: unknown }
    return Array.isArray(raw.buffers) ? (raw.buffers as TerminalBuffer[]) : []
  } catch {
    return []
  }
}

export function saveBuffers(buffers: TerminalBuffer[]): void {
  try {
    const merged = mergeBuffers(buffers, loadBuffers())
    writeFileSync(bufferFile(), JSON.stringify({ buffers: capBuffers(merged, MAX_TOTAL_BYTES) }), 'utf8')
  } catch {
    // best-effort persistence — never block quit on a write error
  }
}
