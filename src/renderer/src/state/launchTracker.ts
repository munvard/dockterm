/** When the app last typed `claude` into each pane (launcher button or the chat
 * empty state). Claude takes a few seconds to draw its box, and chat mode says
 * "Starting Claude…" instead of "isn't running" during that window. */
export const STARTING_WINDOW_MS = 20_000

const launches = new Map<string, number>()

export function markClaudeLaunch(leafId: string, now: number = Date.now()): void {
  launches.set(leafId, now)
}

export function recentlyLaunched(leafId: string, now: number = Date.now()): boolean {
  const t = launches.get(leafId)
  return t !== undefined && now - t >= 0 && now - t < STARTING_WINDOW_MS
}

/** Panes with a send in flight: Claude's box briefly holds the app's own text. */
const sending = new Set<string>()
export const setSending = (leafId: string, on: boolean): void => void (on ? sending.add(leafId) : sending.delete(leafId))
export const isSending = (leafId: string): boolean => sending.has(leafId)
