import { create } from 'zustand'
import type { UsageSnapshot } from '@shared/types'

interface UsageStore {
  snapshot: UsageSnapshot | null
  load: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set) => {
  // Live token usage is pushed from main as the JSONL transcripts grow.
  if (typeof window !== 'undefined' && window.dockterm) {
    window.dockterm.on('usage:changed', (snap) => set({ snapshot: snap }))
  }
  return {
    snapshot: null,
    load: async () => {
      const r = await window.dockterm.invoke('usage:get', undefined)
      if (r.ok) set({ snapshot: r.value })
    }
  }
})
