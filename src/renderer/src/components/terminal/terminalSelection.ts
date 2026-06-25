export interface Pt {
  x: number
  y: number
}
export interface Size {
  w: number
  h: number
}

/** Wrap text in bracketed-paste markers so Claude/zsh/bash treat a multi-line
 * selection as pasted input (lands in the prompt, not submitted line-by-line). */
export function wrapBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`
}

/**
 * Position the selection toolbar near `anchor` (a point at the top of the
 * selection): centered above it, flipping below when too close to the top, and
 * clamped within the viewport. Pure so it's unit-testable.
 */
export function clampToolbar(anchor: Pt, size: Size, viewport: Size, gap = 8): Pt {
  let x = anchor.x - size.w / 2
  let y = anchor.y - size.h - gap
  if (y < gap) y = anchor.y + gap // no room above → drop below the anchor
  x = Math.max(gap, Math.min(x, viewport.w - size.w - gap))
  y = Math.max(gap, Math.min(y, viewport.h - size.h - gap))
  return { x: Math.round(x), y: Math.round(y) }
}
