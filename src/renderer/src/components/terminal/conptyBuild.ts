/** xterm's conpty heuristics (reflow, pulling rows back from scrollback on a
 * taller viewport) key off a Windows build number: they are only right for a
 * conpty at or above this build. */
const CONPTY_REFLOW_BUILD = 21376

/**
 * The build number to give xterm's `windowsPty`. DockTerm always spawns with
 * node-pty's `useConptyDll` (its own recent conpty.dll), so the pty's behaviour
 * is that DLL's, not the OS's: on Windows 10 (build 19045) the OS number would
 * wrongly switch reflow off for a modern conpty.
 */
export function bundledConptyBuild(osBuild: number | undefined): number {
  return Math.max(osBuild ?? 0, CONPTY_REFLOW_BUILD)
}
