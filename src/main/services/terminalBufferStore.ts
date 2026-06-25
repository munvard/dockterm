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
    writeFileSync(bufferFile(), JSON.stringify({ buffers: capBuffers(buffers, MAX_TOTAL_BYTES) }), 'utf8')
  } catch {
    // best-effort persistence — never block quit on a write error
  }
}
