import { paneWriters } from './paneWriters'
import { useMunuStore } from './useMunuStore'

const queue: { leafId: string; key: string }[] = []
let draining = false

function drain(): void {
  const item = queue.shift()
  if (!item) {
    draining = false
    return
  }
  paneWriters.write(item.leafId, item.key)
  setTimeout(drain, 70)
}

/**
 * Write answer key chunks into a pane's PTY ONE AT A TIME, ~70ms apart, through
 * a single serialized queue — Claude's TUI (ink) coalesces a burst of bytes into
 * one keypress and drops the rest, so a paced stream is the only way arrow
 * navigation / toggles register. The queue also keeps rapid clicks from
 * interleaving. Every answer resolves the prompt (toggles don't send keys), so
 * the card closes / munu tucks right away instead of waiting for the classifier
 * to notice the menu is gone (the stale menu lingers in the buffer ~2s).
 */
export function answerPane(leafId: string, keys: string[]): void {
  useMunuStore.getState().markAnswered(leafId)
  for (const key of keys) queue.push({ leafId, key })
  if (!draining) {
    draining = true
    drain()
  }
}
