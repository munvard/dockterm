import { diffLines } from 'diff'

export type PreviewDiffLine =
  | { type: 'add'; text: string }
  | { type: 'del'; text: string }
  | { type: 'gap' }

/**
 * A compact "just the changes" view of two file versions: the added and removed
 * lines, with a gap marker where unchanged regions are skipped. Capped so a huge
 * diff stays a quick hover preview. Pure + unit-testable.
 */
export function buildPreviewDiff(original: string, modified: string, max = 200): PreviewDiffLine[] {
  const out: PreviewDiffLine[] = []
  let pendingGap = false
  for (const part of diffLines(original, modified)) {
    if (part.added || part.removed) {
      if (pendingGap && out.length) out.push({ type: 'gap' })
      pendingGap = false
      const type: 'add' | 'del' = part.added ? 'add' : 'del'
      for (const text of part.value.replace(/\n$/, '').split('\n')) {
        out.push({ type, text })
        if (out.length >= max) return out
      }
    } else if (out.length) {
      // An unchanged region after a change — mark a gap before the next change.
      pendingGap = true
    }
  }
  return out
}
