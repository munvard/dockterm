import { paneWriters } from './paneWriters'
import { sanitizePasteText, wrapBracketedPaste } from '../components/terminal/terminalSelection'

// Claude's TUI (ink) reads the pty a chunk at a time: a bracketed-paste block
// immediately followed by \r can land in the SAME read as one chunk, and ink
// treats the whole thing as pasted text rather than "paste, then submit" — the
// prompt sits typed in the box, unsent, until the next keystroke. Mirrors the
// ~70ms pacing useMunuBridge.ts already uses for munu's answer keys.
const ENTER_DELAY_MS = 70

export type PromptGuard = () => Promise<boolean>

/**
 * Write a prompt into a pane's pty the way Claude's TUI expects it: the
 * bracketed-paste chunk first, then Enter a beat later — never in the same
 * write. Shared by every surface that sends a full prompt. Resolves true only
 * once Enter has been written, and false when the pane has no writer (already
 * closed), the text is empty, or the optional `guard` (is Claude still the
 * foreground program?) says no. The guard runs before the paste and again
 * right before Enter, so a Claude that exits mid-send is not typed into.
 */
export function sendPrompt(leafId: string, text: string, guard?: PromptGuard): Promise<boolean> {
  if (!sanitizePasteText(text)) return Promise.resolve(false)
  if (!guard) return deliver(leafId, text)
  return guard().then((ok) => (ok ? deliver(leafId, text, guard) : false))
}

function deliver(leafId: string, text: string, guard?: PromptGuard): Promise<boolean> {
  // Raw writes (never xterm's paste path, which would wrap the text and the
  // Enter again). Wrap here, and only when the app has bracketed-paste on.
  const body = paneWriters.bracketedPaste(leafId) ? wrapBracketedPaste(text) : sanitizePasteText(text)
  if (!paneWriters.write(leafId, body)) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      const enter = (): void => resolve(paneWriters.write(leafId, '\r'))
      if (guard) void guard().then((ok) => (ok ? enter() : resolve(false)), () => resolve(false))
      else enter()
    }, ENTER_DELAY_MS)
  })
}
