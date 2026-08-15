import type { AskInfo } from '@shared/types'

/**
 * The exact key sequences Claude's menus understand, extracted from the munu
 * overlay so every surface (overlay, chat mode) answers a prompt identically.
 * Pure — no React, no IPC — so the sequences are unit-testable.
 */
export const DOWN = '\x1b[B'
export const UP = '\x1b[A'
export const ENTER = '\r'
export const ESC = '\x1b'

/** Arrow-key chunks to move Claude's menu cursor from row `from` to row `to`. */
export function arrows(from: number, to: number): string[] {
  const k = to >= from ? DOWN : UP
  return Array.from({ length: Math.abs(to - from) }, () => k)
}

/** Rows that open a free-text field ("Type something", "Other", "something else"). */
export function isFreeText(label: string): boolean {
  return /^type\b/i.test(label) || /^other$/i.test(label) || /something else$/i.test(label)
}

/** Keys that choose row `index`. Single-select menus select on the number key for
 * the first nine rows; everything else walks the cursor and presses Enter. */
export function pickKeys(ask: AskInfo, index: number): string[] {
  if (!ask.multiSelect && index < 9) return [String(index + 1)]
  return [...arrows(ask.cursorRow, index), ENTER]
}

/** Keys that apply a multi-select: toggle each CHANGED box top-to-bottom from
 * Claude's real cursor row, then land on Submit and press Enter. */
export function submitKeys(ask: AskInfo, selected: Set<number>): string[] {
  if (ask.submitIndex == null) return []
  const toggles: number[] = []
  ask.options.forEach((_, i) => {
    if (ask.checkable[i] && selected.has(i) !== !!ask.checked[i]) toggles.push(i)
  })
  let cur = ask.cursorRow
  const seq: string[] = []
  for (const t of toggles) {
    seq.push(...arrows(cur, t), ENTER)
    cur = t
  }
  seq.push(...arrows(cur, ask.submitIndex), ENTER)
  return seq
}

/** Keys that answer a free-text row: select it (entering Claude's field), type, Enter. */
export function textKeys(ask: AskInfo, index: number, text: string): string[] {
  const select =
    !ask.multiSelect && index < 9 ? [String(index + 1)] : [...arrows(ask.cursorRow, index), ENTER]
  return [...select, text, ENTER]
}

/** Slash commands that open an interactive picker Claude draws in its own TUI.
 * Chat mode flips back to the terminal after sending one so the user can drive it. */
const PICKERS = new Set([
  '/model', '/tui', '/rewind', '/config', '/agents', '/mcp', '/resume', '/login', '/logout'
])
export function opensPicker(text: string): boolean {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return PICKERS.has(first)
}
