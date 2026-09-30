// Two lines so each fits 80 columns.
export const RESTORE_BANNER =
  '\r\n\x1b[90m──── session restored · running programs did not survive the restart ────\x1b[0m\r\n' +
  '\x1b[90m     run claude --resume to continue\x1b[0m\r\n'

/**
 * What to write once the restored scrollback and banner are on screen, before the new
 * shell starts (`cursorY` is the cursor's viewport row after the banner).
 *
 * On Windows the new shell runs under ConPTY, which believes the screen is empty and
 * paints it with absolute cursor moves from the top-left corner. Restored rows still in
 * the viewport would be overwritten cell by cell (old and new text mixed together), so
 * there the rows above the cursor are scrolled up into the scrollback (from the bottom
 * row, so no blank rows go with them) and the cursor goes home. Other platforms print
 * the prompt below the banner as usual.
 */
export function restoreScrollTail(platform: string, rows: number, cursorY: number): string {
  if (platform !== 'win32' || cursorY <= 0) return ''
  return `\x1b[${rows};1H` + '\n'.repeat(Math.min(cursorY, rows)) + '\x1b[H'
}
