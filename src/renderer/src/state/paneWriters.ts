/**
 * Registry of per-pane input functions, keyed by leaf id. Lets the munu
 * permission HUD answer Claude in the correct pane (route a keystroke), even
 * when the click came from the separate overlay window (via main → this window).
 *
 * `write` is a RAW pty write: use it for everything the app sends itself
 * (commands, prompts, keys). `paste` is xterm's paste path (newline rewrite,
 * bracketed-paste wrapping when the app has that mode on): only for real user
 * pastes and inserting a path or text the way a paste would.
 */
export interface PaneInput {
  write: (text: string) => void
  paste: (text: string) => void
  /** Whether the app in the pane has bracketed-paste mode on. */
  bracketedPaste: () => boolean
}

const writers = new Map<string, PaneInput>()

export const paneWriters = {
  register(leafId: string, input: PaneInput): void {
    writers.set(leafId, input)
  },
  unregister(leafId: string): void {
    writers.delete(leafId)
  },
  write(leafId: string, text: string): boolean {
    const w = writers.get(leafId)
    if (!w) return false
    w.write(text)
    return true
  },
  paste(leafId: string, text: string): boolean {
    const w = writers.get(leafId)
    if (!w) return false
    w.paste(text)
    return true
  },
  bracketedPaste(leafId: string): boolean {
    return writers.get(leafId)?.bracketedPaste() ?? false
  }
}
