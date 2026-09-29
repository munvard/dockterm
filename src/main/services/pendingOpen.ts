/**
 * A folder the OS asked us to open before any window could take it (macOS
 * "Open With" on a cold start, or with every window closed). The window's
 * renderer PULLS it during startup (`project:takePendingOpen`) and opens it
 * instead of the remembered project, so it can't be lost to an event that fires
 * before the renderer is listening or be overwritten by the last-project restore.
 */
let pending: string | null = null

export function setPendingOpen(path: string): void {
  pending = path
}

/** Returns the pending folder once, then clears it. */
export function takePendingOpen(): string | null {
  const p = pending
  pending = null
  return p
}
