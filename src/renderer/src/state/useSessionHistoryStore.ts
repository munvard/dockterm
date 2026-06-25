import { create } from 'zustand'
import type { SessionHistory } from '@shared/types'

const norm = (p: string): string => p.replace(/[\\/]+$/, '')

interface SessionHistoryStore {
  /** Keyed by normalized project path (cwd). */
  byCwd: Record<string, SessionHistory>
  /** Fetch the checkpoints for the session running in pane `leafId` (identified by
   * `sample`, recent buffer lines). `claudeActive` keeps the binding sticky while
   * Claude is running so scrolling away from the bottom can't blank the rail. */
  load: (cwd: string, leafId: string, sample: string[], claudeActive: boolean) => Promise<void>
}

export const useSessionHistoryStore = create<SessionHistoryStore>((set) => ({
  byCwd: {},
  load: async (cwd, leafId, sample, claudeActive) => {
    const r = await window.dockterm.invoke('session:getHistory', {
      cwd,
      sample,
      leafId,
      claudeActive
    })
    if (r.ok) set((s) => ({ byCwd: { ...s.byCwd, [norm(cwd)]: r.value } }))
  }
}))

export const normalizeCwd = norm
