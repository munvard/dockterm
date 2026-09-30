import type { AskInfo, MunuAnswerAction } from '@shared/types'

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

/** Number keys work only in a numbered single-select menu, first nine rows. */
function digitSelects(ask: AskInfo, index: number): boolean {
  return !ask.multiSelect && ask.numbered !== false && index < 9
}

/** Keys that choose row `index`. Numbered single-select menus select on the
 * number key for the first nine rows; everything else walks the cursor and
 * presses Enter. */
export function pickKeys(ask: AskInfo, index: number): string[] {
  if (digitSelects(ask, index)) return [String(index + 1)]
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
  const select = digitSelects(ask, index)
    ? [String(index + 1)]
    : [...arrows(ask.cursorRow, index), ENTER]
  return [...select, text, ENTER]
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/** The key chunks for a semantic answer from the overlay, built from THIS
 * window's own current view of the ask. null when the action does not fit the
 * ask (index out of range, free text into a normal row, nothing to submit) or
 * the text carries control characters. The overlay never supplies raw keys. */
export function actionKeys(ask: AskInfo, action: MunuAnswerAction): string[] | null {
  const n = ask.options.length
  switch (action.kind) {
    case 'cancel':
      return [ESC]
    case 'pick':
      if (action.index < 0 || action.index >= n || isFreeText(ask.options[action.index])) return null
      return pickKeys(ask, action.index)
    case 'text':
      if (action.index < 0 || action.index >= n || !isFreeText(ask.options[action.index])) return null
      if (CONTROL_CHARS.test(action.text)) return null
      return textKeys(ask, action.index, action.text)
    case 'submit': {
      if (ask.submitIndex == null || action.selected.some((i) => i < 0 || i >= n)) return null
      const keys = submitKeys(ask, new Set(action.selected))
      return keys.length ? keys : null
    }
  }
}

/** Content signature of a prompt, to tell a stale menu from a genuinely new one.
 * Deliberately excludes `cursorRow` and `checked` because those change while
 * the SAME prompt is live (as Claude re-parses its position), so the signature
 * stays stable across re-parses and only changes for a genuinely different prompt.
 * Used by the munu store to suppress stale prompts after answering, and by chat
 * mode to detect when a prompt has refreshed so local state (selected, typing,
 * draft) should reset. */
export function askSig(ask: AskInfo | null): string {
  return ask ? `${ask.title ?? ''}${ask.options.join('')}` : ''
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
