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

export const useReadingStore = create<ReadingStore>((set) => ({
  byLeaf: {},
  load: async (cwd, leafId, sample, claudeActive) => {
    const r = await window.dockterm.invoke('reading:get', { cwd, sample, leafId, claudeActive })
    if (r.ok) set((s) => ({ byLeaf: { ...s.byLeaf, [leafId]: r.value } }))
  }
}))
