export type TermKeyAction =
  | 'scroll-bottom'
  | 'scroll-top'
  | 'page-up'
  | 'page-down'
  | 'copy'
  | 'paste'
  | null

/** The subset of KeyboardEvent fields the resolver needs (so it's pure/testable). */
export interface TermKeyEvent {
  type: string
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** The letter a key types, for layout-independent shortcuts: the typed character when it is
 * a Latin letter (so Ctrl+K on Dvorak is not mistaken for the physical C/V key), the
 * physical key only when the layout types something else (Cyrillic, Greek...). */
function keyLetter(e: TermKeyEvent): string {
  if (/^[a-zA-Z]$/.test(e.key)) return e.key.toLowerCase()
  if (e.code === 'KeyC') return 'c'
  if (e.code === 'KeyV') return 'v'
  return ''
}

/**
 * Decide what a keydown should do INSIDE the terminal, returning null to let the
 * key pass through to the shell. Pure so it can be unit-tested.
 *
 * - macOS uses ⌘ for scroll jumps and native ⌘C/⌘V (handled by the OS, so we
 *   never intercept clipboard keys on darwin).
 * - Linux/Windows have no ⌘ and Ctrl+C is SIGINT, so copy is Ctrl+Shift+C and paste is
 *   Ctrl+Shift+V (also Ctrl/Shift+Insert). Windows additionally takes plain Ctrl+V, and
 *   plain Ctrl+C while text is selected, like Windows Terminal.
 */
export function resolveTermKey(
  e: TermKeyEvent,
  platform: string,
  hasSelection = false
): TermKeyAction {
  if (e.type !== 'keydown') return null
  if (e.metaKey && e.key === 'ArrowDown') return 'scroll-bottom'
  if (e.metaKey && e.key === 'ArrowUp') return 'scroll-top'
  if (e.shiftKey && e.key === 'PageUp') return 'page-up'
  if (e.shiftKey && e.key === 'PageDown') return 'page-down'
  if (platform !== 'darwin' && !e.altKey && !e.metaKey) {
    const letter = keyLetter(e)
    if (e.ctrlKey && e.shiftKey) {
      if (letter === 'c') return 'copy'
      if (letter === 'v') return 'paste'
    }
    // Like Windows Terminal: plain Ctrl+V pastes (xterm would otherwise send ^V and
    // swallow the key), and Ctrl+C copies ONLY while text is selected, so with no
    // selection it is still SIGINT. Windows only: on Linux plain Ctrl+V/Ctrl+C belong
    // to vim, nano, emacs and readline, as in every Linux terminal.
    if (platform === 'win32' && e.ctrlKey && !e.shiftKey) {
      if (letter === 'v') return 'paste'
      if (letter === 'c' && hasSelection) return 'copy'
    }
    if (e.ctrlKey && !e.shiftKey && e.key === 'Insert') return 'copy'
    if (e.shiftKey && !e.ctrlKey && e.key === 'Insert') return 'paste'
  }
  return null
}
