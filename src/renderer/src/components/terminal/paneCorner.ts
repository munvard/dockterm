/**
 * Keeps a single pane's floating controls off terminal content. The controls sit
 * over the top-right corner; when a full-screen app draws there (Claude Code's
 * diff panel puts its close button in that corner) they must not cover it.
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** How many columns (from the right edge) and rows (from the top) of the terminal
 * grid a floating box covers. Zero when the box does not overlap the grid. */
export function coveredCells(
  box: Box,
  screen: Box,
  cols: number,
  rows: number
): { cols: number; rows: number } {
  const w = screen.right - screen.left
  const h = screen.bottom - screen.top
  if (cols <= 0 || rows <= 0 || w <= 0 || h <= 0) return { cols: 0, rows: 0 }
  if (box.left >= screen.right || box.bottom <= screen.top) return { cols: 0, rows: 0 }
  const cellW = w / cols
  const cellH = h / rows
  const c = Math.ceil((screen.right - Math.max(box.left, screen.left)) / cellW)
  const r = Math.ceil((Math.min(box.bottom, screen.bottom) - screen.top) / cellH)
  return { cols: Math.max(0, Math.min(cols, c)), rows: Math.max(0, Math.min(rows, r)) }
}

/** True when every covered cell is blank (each string is one row's covered cells). */
export function cornerBlank(cells: readonly string[]): boolean {
  return cells.every((s) => s.trim() === '')
}

/** Content in the corner hides the controls at once; they come back only after the
 * corner has stayed blank for `clearMs`, so text scrolling past does not make them
 * blink. `recheckIn` asks the caller to look again even if no output arrives. */
export class CornerHold {
  busy = false
  private clearSince: number | null = null

  constructor(private readonly clearMs = 1200) {}

  update(blank: boolean, now: number): { busy: boolean; recheckIn?: number } {
    if (!blank) {
      this.busy = true
      this.clearSince = null
      return { busy: true }
    }
    if (!this.busy) return { busy: false }
    if (this.clearSince === null) this.clearSince = now
    const left = this.clearMs - (now - this.clearSince)
    if (left > 0) return { busy: true, recheckIn: left }
    this.busy = false
    this.clearSince = null
    return { busy: false }
  }
}
