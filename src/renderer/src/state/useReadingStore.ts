import { create } from 'zustand'
import type { ReadingConversation } from '@shared/types'

const norm = (p: string): string => p.replace(/[\\/]+$/, '')

interface ReadingStore {
  /** Keyed by normalized project path (cwd). */
  byCwd: Record<string, ReadingConversation>
  load: (cwd: string, leafId: string, sample: string[], claudeActive: boolean) => Promise<void>
}

export const useReadingStore = create<ReadingStore>((set) => ({
  byCwd: {},
  load: async (cwd, leafId, sample, claudeActive) => {
    const r = await window.dockterm.invoke('reading:get', { cwd, sample, leafId, claudeActive })
    if (r.ok) set((s) => ({ byCwd: { ...s.byCwd, [norm(cwd)]: r.value } }))
  }
}))

export const normalizeReadingCwd = norm
