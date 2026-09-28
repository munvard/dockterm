/**
 * Temporary local stand-in for the shared shortcut-label helper described in
 * the review plan's "Global key scheme" (a single k(mac, win) in a shared
 * module, e.g. hooks/keys.ts) — that module is being introduced on a sibling
 * branch (W1) that this worktree doesn't have. This exists only so the W5
 * files that display a shortcut label don't hard-code a mac-only ⌘ glyph on
 * Windows/Linux in the meantime. Once branches are merged, replace these
 * imports with the real shared helper and delete this file.
 */
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/** `mac` on macOS, `win` on Windows/Linux. */
export function k(mac: string, win: string): string {
  return isMac ? mac : win
}
