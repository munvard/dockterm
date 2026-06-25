import { paneBufferType, paneVisibleText, scrollPaneToText } from './terminalPool'
import { paneWriters } from '../../state/paneWriters'
import { matchKey, needleFor } from './claudeScrollMatch'

/**
 * Jump a pane to a past checkpoint (a user prompt) so the user can SEE it.
 *
 * Claude Code's fullscreen TUI (Ink) renders on the terminal's ALTERNATE screen
 * buffer and owns all scrolling — there is no xterm scrollback to seek, and the
 * conversation isn't in xterm's buffer at all (Claude redraws a scrolled view
 * itself). But Claude honors the standard scroll keys (PageUp / Ctrl+End — its
 * documented fullscreen bindings). So we drive Claude's OWN scroll: page up from
 * the live bottom, read the redrawn screen after each step, and stop once the
 * prompt is on screen WITH HEADROOM — a few rows below the top edge so it isn't cut
 * off (paging up moves content downward, so an extra page lowers the prompt into
 * clear view). A half-screen step overlaps the previous view by half, so no prompt
 * is skipped. If we page to the very top without seeing it, we return to the live
 * conversation and the rail's inline text is the fallback.
 *
 * When the pane is NOT on the alternate buffer (a shell, or Claude's classic
 * renderer), the text IS in xterm's scrollback, so we seek it there directly.
 */

const KEY_PGUP = '\x1b[5~'
const KEY_CTRL_END = '\x1b[1;5F' // jump to latest + resume auto-follow

const MAX_STEPS = 130 // half-screen each; covers a very long conversation
const STEP_MS = 80 // let Claude (Ink) finish redrawing between pages
const SETTLE_MS = 200 // a longer wait before concluding "reached the top"
const HEADROOM = 3 // rows the prompt should sit below the top edge once landed
const PINNED_TAIL = 7 // pinned input/status rows to ignore when checking movement

export type ScrollOutcome = 'scrolled' | 'notfound' | 'unavailable'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Only one jump at a time per session — a new click cancels the in-flight one so
// rapid clicks don't drive the terminal in two directions at once.
let jumpToken = 0

/** Match key of the conversation region only (drop the pinned input/status rows) —
 * so a blinking cursor/timer there isn't mistaken for "still scrolling". */
const upperKey = (leafId: string): string => {
  const rows = paneVisibleText(leafId).split('\n')
  return matchKey(rows.slice(0, Math.max(1, rows.length - PINNED_TAIL)).join('\n'))
}

/** The row index at which `needle` finishes within the current view, or -1. Rows
 * are concatenated (not space-joined) so a prompt wrapped across rows still matches.
 */
const needleRow = (leafId: string, needle: string): number => {
  const rows = paneVisibleText(leafId).split('\n')
  let acc = ''
  for (let i = 0; i < rows.length; i++) {
    acc += matchKey(rows[i])
    if (acc.includes(needle)) return i
  }
  return -1
}

export async function scrollToCheckpoint(leafId: string, text: string): Promise<ScrollOutcome> {
  const needle = needleFor(text)
  if (needle.length < 8) return 'unavailable'

  const type = paneBufferType(leafId)
  if (type === null) return 'unavailable'

  // Shell / classic renderer: the text is in xterm's own scrollback.
  if (type === 'normal') return scrollPaneToText(leafId, text) ? 'scrolled' : 'notfound'

  // Fullscreen Claude: drive its own scroll until the prompt is comfortably on screen.
  const token = ++jumpToken
  const cancelled = (): boolean => token !== jumpToken

  // Already well-placed? (a recent prompt the user can already see)
  if (needleRow(leafId, needle) >= HEADROOM) return 'scrolled'

  let seen = needleRow(leafId, needle) >= 0
  let prev = ''
  let stable = 0
  for (let i = 0; i < MAX_STEPS; i++) {
    if (cancelled()) return 'unavailable'
    if (!paneWriters.write(leafId, KEY_PGUP)) return 'unavailable'
    await delay(STEP_MS)
    if (cancelled()) return 'unavailable'

    const row = needleRow(leafId, needle)
    if (row >= HEADROOM) return 'scrolled' // visible with headroom — done
    if (row >= 0) seen = true // visible but still near the top → page once more

    const cur = upperKey(leafId)
    if (cur === prev) {
      // Two identical conversation frames → likely the very top. Confirm with a
      // longer settle (a slow redraw can momentarily look "stopped").
      if (++stable >= 2) {
        await delay(SETTLE_MS)
        if (cancelled()) return 'unavailable'
        const settledRow = needleRow(leafId, needle)
        if (settledRow >= HEADROOM) return 'scrolled'
        if (upperKey(leafId) === cur) break // genuinely stopped at the top
        stable = 0 // it was still moving — keep going
      }
    } else {
      stable = 0
      prev = cur
    }
  }

  // Reached the top. If the prompt is the very first thing in the conversation it's
  // on screen (just can't gain headroom) — that still counts as found.
  if (seen || needleRow(leafId, needle) >= 0) return 'scrolled'

  paneWriters.write(leafId, KEY_CTRL_END) // restore the live view
  return 'notfound'
}
