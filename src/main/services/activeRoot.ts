import type { IpcMainInvokeEvent } from 'electron'

/** Active project root per renderer window, keyed by webContents id. Lets each
 * window (and, with focus tracking, each focused pane) target a different
 * project without a single global root. */
const roots = new Map<number, string>()

export function setActiveRoot(webContentsId: number, root: string): void {
  roots.set(webContentsId, root)
}

export function getActiveRoot(webContentsId: number): string {
  const root = roots.get(webContentsId)
  if (!root) throw new Error('No active project for this window')
  return root
}

export function clearActiveRoot(webContentsId: number): void {
  roots.delete(webContentsId)
}

/** Resolve the active project root for the window that sent an IPC request. */
export function rootFor(event: IpcMainInvokeEvent): string {
  return getActiveRoot(event.sender.id)
}
