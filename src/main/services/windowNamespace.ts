import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Per-window identities issued by main, never by the renderer. Two windows can
 * hold panes with the same `leafId`, so anything keyed by leafId alone (saved
 * scrollback, transcript bindings) would let one window read or overwrite the
 * other's.
 */

/** Key for in-memory, per-session state (transcript bindings): the sender's
 * webContents id plus the pane's leafId. */
export function paneKey(senderId: number, leafId: string): string {
  return `${senderId}\0${leafId}`
}

/** The project each window opened (`project:open`). NOT the active root: that
 * follows the focused pane's cwd (`project:setActiveRoot`), so it moves around
 * inside one window, while the opened project is what a restart reopens. */
const openedProject = new Map<number, string>()

/** The same project as the user's path, casing intact (`openedProject` holds the
 * canonical form, which is lower-cased on Windows). */
const openedProjectPath = new Map<number, string>()

export function setWindowProject(senderId: number, projectPath: string): void {
  openedProject.set(senderId, canonical(projectPath))
  openedProjectPath.set(senderId, projectPath)
}

/** The project a window opened, as passed to `project:open`, or null. */
export function getWindowProject(senderId: number): string | null {
  return openedProjectPath.get(senderId) ?? null
}

function canonical(root: string): string {
  let real: string
  try {
    real = realpathSync(root)
  } catch {
    real = resolve(root)
  }
  return process.platform === 'win32' ? real.toLowerCase() : real
}

/**
 * Namespace for a window's PERSISTED terminal buffers: the canonical path of
 * the project the window opened. It is recorded by main when the window calls
 * `project:open` (main checks the folder there), never taken from a buffer
 * request, so it survives an app restart (the same project reopens under the
 * same namespace) while a window on another project can neither read nor
 * overwrite these buffers. Kept per webContents for the window's whole life, so
 * the final save from `beforeunload` still works after teardown cleared the
 * window's roots. Throws when the window has not opened a project.
 */
export function bufferNamespace(senderId: number): string {
  const ns = openedProject.get(senderId)
  if (!ns) throw new Error('No project is open in this window')
  return ns
}
