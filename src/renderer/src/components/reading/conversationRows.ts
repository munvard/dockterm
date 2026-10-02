import type { ReadingMessage } from '@shared/types'

/** True when two conversation rows render the same. Every poll delivers fresh
 * objects over IPC, so rows compare by value, not identity. */
export function sameMessage(a: ReadingMessage, b: ReadingMessage): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.role !== b.role || a.text !== b.text) return false
  const x = a.tool
  const y = b.tool
  if (!x || !y) return x === y
  return x.ok === y.ok && x.name === y.name && x.summary === y.summary
}

/** Rows mounted on first open, then MORE_ROWS per idle slice until all are in.
 * A 2000-row conversation mounted at once (markdown for every assistant reply)
 * was one long task of about 200 ms. */
export const FIRST_ROWS = 120
export const MORE_ROWS = 240

/** Index of the first mounted row when the newest `shown` rows are mounted. */
export function rowStart(total: number, shown: number): number {
  return Math.max(0, total - shown)
}
