import type { ReactNode } from 'react'

/**
 * Split `text` (which sits at `offset` inside the string `positions` index into)
 * into plain and highlighted runs.
 */
export function highlightRuns(text: string, offset: number, positions: readonly number[]): ReactNode[] {
  if (positions.length === 0) return [text]
  const out: ReactNode[] = []
  let run = ''
  let marked = false
  let key = 0
  const set = new Set(positions)
  const flush = (): void => {
    if (!run) return
    out.push(marked ? <mark key={key++}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const m = set.has(offset + i)
    if (m !== marked) {
      flush()
      marked = m
    }
    run += text[i]
  }
  flush()
  return out
}

/** Highlight [start, end) ranges inside a line of text. */
export function rangeRuns(text: string, ranges: ReadonlyArray<readonly [number, number]>): ReactNode[] {
  if (ranges.length === 0) return [text]
  const out: ReactNode[] = []
  let at = 0
  let key = 0
  for (const [s, e] of ranges) {
    if (s > at) out.push(text.slice(at, s))
    if (e > s) out.push(<mark key={key++}>{text.slice(s, e)}</mark>)
    at = Math.max(at, e)
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}
