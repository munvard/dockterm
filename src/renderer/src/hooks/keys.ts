/**
 * Shared platform-adaptive key helpers: the single source of truth for what
 * counts as "the app shortcut modifier" and for labeling a shortcut in the
 * UI.
 *
 * macOS: app shortcuts = Cmd+key, with NO Ctrl (the OS keeps Ctrl+letter for
 * the PTY). Windows/Linux: app shortcuts = Ctrl+Shift+key, so plain
 * Ctrl+letter is always left for the shell (Ctrl+R is reverse-search,
 * Ctrl+M is a carriage return, Ctrl+W deletes a word, etc).
 */
export type Platform = 'mac' | 'win' | 'linux'

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'linux'
  if (/Mac/i.test(navigator.userAgent)) return 'mac'
  if (/Win/i.test(navigator.userAgent)) return 'win'
  return 'linux'
}

export const isMac = detectPlatform() === 'mac'

/** Label a shortcut for display: k('⌘R', 'Ctrl+Shift+R') picks the right one
 * for the current platform. Never hard-code a ⌘ glyph on Windows/Linux. */
export function k(mac: string, win: string): string {
  return isMac ? mac : win
}

export type ShortcutId =
  | 'panel:files'
  | 'panel:git'
  | 'panel:review'
  | 'panel:mcp'
  | 'toggleMiniTerm'
  | 'openProject'
  | 'newTab'
  | 'newWindow'
  | 'splitRight'
  | 'toggleChat'
  | 'toggleZen'
  | 'palette'
  | 'compose'
  | 'settings'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'switchTab'
  | 'close'

export interface MatchResult {
  id: ShortcutId
  /** 0-based tab index; only set for 'switchTab'. */
  tabIndex?: number
}

/** The subset of KeyboardEvent matchShortcut needs — kept minimal so tests
 * can pass plain objects instead of constructing real KeyboardEvents. */
export interface KeyLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Pure shortcut matcher: no DOM/store access, so it's unit-testable in
 * isolation and shared by useShortcuts, the ONE place that owns the global
 * keydown listener. Matches on e.code (KeyT, Digit1, Period…), not e.key, so
 * non-Latin layouts (Armenian, Russian…) still fire the shortcut that's
 * physically in the same place. Returns null when the key should pass
 * through untouched — most importantly, plain Ctrl+letter on Windows/Linux
 * always does.
 */
export function matchShortcut(e: KeyLike, platform: Platform): MatchResult | null {
  const mac = platform === 'mac'
  const cmdOnly = mac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
  const ctrlShift = !mac && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
  const withShift = mac
    ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey
    : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
  // The app's one "primary" modifier combo: Cmd alone on mac, Ctrl+Shift
  // elsewhere. Plain Ctrl+letter on Windows/Linux never matches this, so it
  // always falls through to the shell.
  const primary = cmdOnly || ctrlShift

  const panel = (code: string): boolean => primary && e.code === code

  if (panel('KeyB')) return { id: 'panel:files' }
  if (panel('KeyG')) return { id: 'panel:git' }
  // Review lives on E — R is the per-pane chat/terminal toggle.
  if (panel('KeyE')) return { id: 'panel:review' }
  if (withShift && e.code === 'KeyM') return { id: 'panel:mcp' }
  if (primary && e.code === 'KeyJ') return { id: 'toggleMiniTerm' }
  if (primary && e.code === 'KeyO') return { id: 'openProject' }
  if (primary && e.code === 'KeyT') return { id: 'newTab' }
  if (primary && e.code === 'KeyN') return { id: 'newWindow' }
  if (primary && e.code === 'KeyD') return { id: 'splitRight' }
  if (primary && e.code === 'KeyR') return { id: 'toggleChat' }
  if (primary && e.code === 'Period') return { id: 'toggleZen' }

  // Command palette: Cmd/Ctrl+Shift+P, or Cmd+K (mac) / Ctrl+Shift+K (win/linux)
  if ((withShift && e.code === 'KeyP') || (cmdOnly && e.code === 'KeyK') || (ctrlShift && e.code === 'KeyK')) {
    return { id: 'palette' }
  }

  // Compose a long prompt — ⌘⇧⏎ (mac) / Ctrl+Shift+⏎ (win/linux).
  if (withShift && e.code === 'Enter') return { id: 'compose' }

  // Settings: Cmd+, / Ctrl+,
  if ((mac ? e.metaKey : e.ctrlKey) && e.code === 'Comma') return { id: 'settings' }

  // UI zoom: Cmd/Ctrl + = / - / 0 (resets to 100%).
  const zoomMod = (mac ? e.metaKey : e.ctrlKey) && !e.altKey
  if (zoomMod) {
    if (e.code === 'Equal' || e.code === 'NumpadAdd') return { id: 'zoomIn' }
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') return { id: 'zoomOut' }
    if (e.code === 'Digit0' || e.code === 'Numpad0') return { id: 'zoomReset' }
  }

  // Switch to tab N — ⌘1-9 (mac) / Ctrl+Shift+1-9 (win/linux).
  if (primary) {
    const m = /^Digit([1-9])$/.exec(e.code)
    if (m) return { id: 'switchTab', tabIndex: Number(m[1]) - 1 }
  }

  // Close — ⌘W (mac) / Ctrl+Shift+W (win/linux). Which thing it closes
  // (editor tab vs. terminal pane) depends on DOM focus, decided by the
  // caller — this matcher only says the combo fired.
  if (primary && e.code === 'KeyW') return { id: 'close' }

  return null
}
