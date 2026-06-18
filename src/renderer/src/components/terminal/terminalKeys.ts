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

/**
 * Decide what a keydown should do INSIDE the terminal, returning null to let the
 * key pass through to the shell. Pure so it can be unit-tested.
 *
 * - macOS uses ⌘ for scroll jumps and native ⌘C/⌘V (handled by the OS, so we
 *   never intercept clipboard keys on darwin).
 * - Linux/Windows have no ⌘ and Ctrl+C is SIGINT, so the convention is
 *   Ctrl+Shift+C / Ctrl+Shift+V for copy / paste.
 */
export function resolveTermKey(e: TermKeyEvent, platform: string): TermKeyAction {
  if (e.type !== 'keydown') return null
  if (e.metaKey && e.key === 'ArrowDown') return 'scroll-bottom'
  if (e.metaKey && e.key === 'ArrowUp') return 'scroll-top'
  if (e.shiftKey && e.key === 'PageUp') return 'page-up'
  if (e.shiftKey && e.key === 'PageDown') return 'page-down'
  if (platform !== 'darwin' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    if (e.code === 'KeyC' || e.key === 'C' || e.key === 'c') return 'copy'
    if (e.code === 'KeyV' || e.key === 'V' || e.key === 'v') return 'paste'
  }
  return null
}
