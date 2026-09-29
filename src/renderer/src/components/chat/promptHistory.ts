/** Pure prompt-history navigation (Up / Down in the composer). */

export const HISTORY_MAX = 100

export interface HistoryNav {
  /** -1 = not browsing. 0 = newest entry. */
  index: number
  /** What the user had typed before browsing, restored when they step back past the newest. */
  stash: string
}

export const IDLE_NAV: HistoryNav = { index: -1, stash: '' }

/** Add an entry (newest last). Blank and consecutive duplicates are skipped. */
export function pushHistory(list: string[], entry: string, max = HISTORY_MAX): string[] {
  const e = entry.trim()
  if (!e || list[list.length - 1] === e) return list
  const next = [...list, e]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Older transcript prompts first, then this session's, without repeats (latest occurrence kept). */
export function mergeHistory(transcript: string[], memory: string[], max = HISTORY_MAX): string[] {
  const all = [...transcript, ...memory].map((s) => s.trim()).filter(Boolean)
  const lastIdx = new Map<string, number>()
  all.forEach((s, i) => lastIdx.set(s, i))
  const out = all.filter((s, i) => lastIdx.get(s) === i)
  return out.length > max ? out.slice(out.length - max) : out
}

/**
 * Up recalls on an empty input or with the caret at the very start; while
 * already browsing it keeps going from the first line. Down only while
 * browsing, from the last line.
 */
export function shouldRecall(
  dir: 'up' | 'down',
  value: string,
  selStart: number,
  selEnd: number,
  nav: HistoryNav
): boolean {
  if (selStart !== selEnd) return false
  if (dir === 'up') {
    if (value.length === 0 || selStart === 0) return true
    return nav.index >= 0 && !value.slice(0, selStart).includes('\n')
  }
  return nav.index >= 0 && !value.slice(selEnd).includes('\n')
}

export interface StepResult {
  nav: HistoryNav
  /** The new textarea value, or null when nothing changes. */
  text: string | null
}

export function stepHistory(list: string[], nav: HistoryNav, dir: 'up' | 'down', current: string): StepResult {
  if (list.length === 0) return { nav, text: null }
  if (dir === 'up') {
    const index = nav.index + 1
    if (index >= list.length) return { nav, text: null }
    const stash = nav.index === -1 ? current : nav.stash
    return { nav: { index, stash }, text: list[list.length - 1 - index] }
  }
  if (nav.index < 0) return { nav, text: null }
  if (nav.index === 0) return { nav: IDLE_NAV, text: nav.stash }
  const index = nav.index - 1
  return { nav: { index, stash: nav.stash }, text: list[list.length - 1 - index] }
}
