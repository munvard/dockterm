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
  // The roots a window has had are only valid for that window; forget them too or
  // every closed or reloaded window leaks its set.
  knownRoots.delete(webContentsId)
}

/** Resolve the active project root for the window that sent an IPC request. */
export function rootFor(event: IpcMainInvokeEvent): string {
  return getActiveRoot(event.sender.id)
}

/** Every root a window has had active, so a file opened under one root (e.g. by
 * a pane that was later unfocused) can still be saved to the right place even
 * after the window's single "active" root moves on to another focused pane.
 * Additive to the single-root map above — W2 owns setActiveRoot/getActiveRoot. */
const knownRoots = new Map<number, Set<string>>()

/** Record a root as valid for this window (call wherever rootFor(event) is
 * actually used to serve a request, so the set only grows with roots the
 * window has genuinely been pointed at). */
export function rememberKnownRoot(webContentsId: number, root: string): void {
  let set = knownRoots.get(webContentsId)
  if (!set) {
    set = new Set()
    knownRoots.set(webContentsId, set)
  }
  set.add(root)
}

/** Whether `root` is one this window has had active before (not necessarily
 * right now) — used to validate a root a renderer explicitly passes along with
 * a request, instead of trusting any arbitrary path. */
export function isKnownRoot(webContentsId: number, root: string): boolean {
  return knownRoots.get(webContentsId)?.has(root) ?? false
}

/** Roots this window has had active (for path checks that must stay inside a project). */
export function knownRootsOf(webContentsId: number): string[] {
  const out = new Set(knownRoots.get(webContentsId) ?? [])
  const active = roots.get(webContentsId)
  if (active) out.add(active)
  return [...out]
}
