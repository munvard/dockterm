/** How many leading items fit in `available` px, each `gap` px apart. */
export function countFitting(widths: number[], gap: number, available: number): number {
  let used = 0
  for (let i = 0; i < widths.length; i++) {
    used += widths[i] + gap
    if (used > available) return i
  }
  return widths.length
}
