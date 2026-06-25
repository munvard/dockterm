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
 * Frame a terminal selection as a tidy reference to paste into Claude, leaving
 * the cursor on a fresh line for the user's actual question. A single line uses
 * inline code (or quotes if it already contains a backtick); multiple lines
 * become a markdown blockquote, which never breaks on backticks or fences.
 * Pure so it's unit-testable.
 */
export function buildClaudeReference(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (body === '') return ''
  if (!body.includes('\n')) {
    const inline = body.includes('`') ? `"${body}"` : `\`${body}\``
    return `Referencing this from my terminal: ${inline}\n`
  }
  const quoted = body
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  return `Referencing this from my terminal:\n\n${quoted}\n\n`
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

/**
 * Place a hover preview card near the cursor `anchor`: prefer below-right,
 * flipping to the opposite side when it would overflow, then clamp inside the
 * viewport. Pure so it's unit-testable.
 */
export function placePreview(anchor: Pt, size: Size, viewport: Size, gap = 14): Pt {
  let x = anchor.x + gap
  if (x + size.w + gap > viewport.w) x = anchor.x - gap - size.w
  x = Math.max(gap, Math.min(x, viewport.w - size.w - gap))
  let y = anchor.y + gap
  if (y + size.h + gap > viewport.h) y = anchor.y - gap - size.h
  y = Math.max(gap, Math.min(y, viewport.h - size.h - gap))
  return { x: Math.round(x), y: Math.round(y) }
}
