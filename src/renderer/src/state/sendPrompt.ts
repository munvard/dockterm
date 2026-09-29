import { paneWriters } from './paneWriters'
import { sanitizePasteText, wrapBracketedPaste } from '../components/terminal/terminalSelection'

// Claude's TUI (ink) reads the pty a chunk at a time: a bracketed-paste block
// immediately followed by \r can land in the SAME read as one chunk, and ink
// treats the whole thing as pasted text rather than "paste, then submit" — the
// prompt sits typed in the box, unsent, until the next keystroke. Mirrors the
// ~70ms pacing useMunuBridge.ts already uses for munu's answer keys.
const ENTER_DELAY_MS = 70

/**
 * Write a prompt into a pane's pty the way Claude's TUI expects it: the
 * bracketed-paste chunk first, then Enter a beat later — never in the same
 * write. Shared by every surface that sends a full prompt (the Compose overlay
 * today; the chat composer is meant to adopt it too). Returns false when the
 * pane has no registered writer (e.g. it already closed).
 */
export function sendPrompt(leafId: string, text: string): boolean {
  if (!sanitizePasteText(text)) return false
  // Raw writes (never xterm's paste path, which would wrap the text and the
  // Enter again). Wrap here, and only when the app has bracketed-paste on.
  const body = paneWriters.bracketedPaste(leafId) ? wrapBracketedPaste(text) : sanitizePasteText(text)
  const wrote = paneWriters.write(leafId, body)
  if (!wrote) return false
  setTimeout(() => {
    paneWriters.write(leafId, '\r')
  }, ENTER_DELAY_MS)
  return true
}
