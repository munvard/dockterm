/** Pure paste rules for the chat composer. */
import { htmlToMarkdown, shouldConvertHtml } from './htmlToMarkdown'

export const LARGE_LINES = 40
export const LARGE_CHARS = 4000

export function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

/** More than 40 lines or more than 4000 characters becomes a chip. */
export function isLargePaste(text: string): boolean {
  return lineCount(text) > LARGE_LINES || text.length > LARGE_CHARS
}

export function chipLabel(text: string): string {
  const n = lineCount(text)
  return `Pasted text · ${n} line${n === 1 ? '' : 's'}`
}

export interface ClipboardPayload {
  text: string
  html: string
  types: readonly string[]
}

/**
 * What text a paste should insert: Markdown for structural rich HTML that did
 * not come from a code editor, else the plain text. Line endings normalised.
 */
export function pasteText(p: ClipboardPayload, plainOnly = false): string {
  const plain = p.text.replace(/\r\n?/g, '\n')
  if (plainOnly || !p.html || !shouldConvertHtml(p.html, p.types)) return plain
  const md = htmlToMarkdown(p.html)
  return md.trim().length > 0 ? md : plain
}

export function insertAtCaret(
  value: string,
  start: number,
  end: number,
  insert: string
): { value: string; caret: number } {
  const next = value.slice(0, start) + insert + value.slice(end)
  return { value: next, caret: start + insert.length }
}
