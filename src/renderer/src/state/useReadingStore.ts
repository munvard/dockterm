import { create } from 'zustand'
import type { ReadingConversation } from '@shared/types'

interface ReadingStore {
  /**
   * Keyed by pane `leafId`, NOT by cwd. Main binds a transcript per pane, so two
   * chat panes in the same folder (e.g. a split, which inherits its parent's cwd)
   * legitimately resolve to DIFFERENT sessions — keying by cwd made them overwrite
   * each other's conversation on every poll.
   */
  byLeaf: Record<string, ReadingConversation>
  /** `cwd` is still sent: main needs it to find the project's transcripts. */
  load: (cwd: string, leafId: string, sample: string[], claudeActive: boolean) => Promise<void>
}

// Two surfaces can legitimately poll the SAME leafId at once (the docked Reading
// panel and a pane's Chat mode both bound to it), each on its own timer. Without
// this, both fire their own reading:get for the same leaf and main can see two
// concurrent requests for the same transcript — collapse them into one in-flight
// call per leafId instead of racing.
const inFlight = new Map<string, Promise<void>>()

export const useReadingStore = create<ReadingStore>((set, get) => ({
  byLeaf: {},
  load: (cwd, leafId, sample, claudeActive) => {
    const existing = inFlight.get(leafId)
    if (existing) return existing
    const sinceRevision = get().byLeaf[leafId]?.revision
    const p = window.dockterm
      .invoke('reading:get', { cwd, sample, leafId, claudeActive, sinceRevision })
      .then((r) => {
        // `unchanged` means main found nothing new since sinceRevision — keep
        // the existing messages instead of overwriting them with an empty list
        // (and skip the `set()` entirely so ConversationList's React.memo bails).
        if (r.ok && !r.value.unchanged) set((s) => ({ byLeaf: { ...s.byLeaf, [leafId]: r.value } }))
      })
      .finally(() => {
        if (inFlight.get(leafId) === p) inFlight.delete(leafId)
      })
    inFlight.set(leafId, p)
    return p
  }
}))
