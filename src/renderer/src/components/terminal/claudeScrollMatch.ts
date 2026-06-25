/**
 * Pure text-matching helpers for jumping to a checkpoint. Kept free of any DOM /
 * xterm imports so they can be unit-tested directly (the scroll driver in
 * claudeScrollTo.ts uses these on the live terminal).
 */

/** Reduce text to comparable letters/digits so terminal wrapping, box-drawing chrome
 * and the leading "> " of a rendered prompt can't defeat a match. */
export const matchKey = (s: string): string =>
  s
    .replace(/\[image #\d+\]/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/** A distinctive needle from a prompt preview — short enough to survive line-wrap
 * within a single rendered view, long enough to be unambiguous. */
export const needleFor = (text: string): string => matchKey(text).slice(0, 28)
