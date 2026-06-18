/** Whether the floating munu should be revealed (slid down) right now.
 * Pinned forces it permanently visible; otherwise it peeks for asks/cursor/peek. */
export function wantReveal(opts: {
  pinned: boolean
  cursorInZone: boolean
  hasUnseenAsk: boolean
  peekActive: boolean
}): boolean {
  return opts.pinned || opts.hasUnseenAsk || opts.cursorInZone || opts.peekActive
}
