import type { ClaudeState } from './claudeStatus'

/** How long 'idle' must hold before a working Claude counts as done. */
export const IDLE_HOLD_MS = 1200

export interface HeldStatus {
  state: ClaudeState
  /** Set while an idle reading is being held back: read the screen again after this many ms. */
  recheckIn?: number
}

/**
 * Smooths Claude's status read from the screen. A redraw or an unusual spinner frame
 * can blank the working line for a moment; without this the pane flips working → idle
 * → working and the chat's elapsed timer restarts at 0 s. Only working → idle waits;
 * every other change goes through at once.
 */
export function createStatusHold(holdMs = IDLE_HOLD_MS): (next: ClaudeState, now: number) => HeldStatus {
  let last: ClaudeState = 'idle'
  let idleSince: number | null = null
  return (next, now) => {
    if (next === 'idle' && last === 'working') {
      idleSince ??= now
      const waited = now - idleSince
      if (waited < holdMs) return { state: 'working', recheckIn: holdMs - waited }
    }
    idleSince = null
    last = next
    return { state: next }
  }
}
