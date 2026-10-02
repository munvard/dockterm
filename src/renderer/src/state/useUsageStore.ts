import { create } from 'zustand'
import type { UsageSnapshot } from '@shared/types'
import type { RealUsage } from '@shared/usageReal'
import type { UsageSample } from '@shared/usageHistory'
import { reduceReal } from './realUsage'

interface UsageStore {
  /** LOCAL token statistics from transcripts (breakdown by day / model / project).
   * Its fiveHour / weekly percentages are an estimate, never Claude's real numbers. */
  snapshot: UsageSnapshot | null
  /** REAL usage as Claude Code reported it (status line capture): the 5-hour and
   * 7-day percentages with reset times, plus context / model / cost of the session
   * seen last. null = nothing captured yet. A window is null when Claude reported
   * none or it has reset. Use pruneRealUsage(real, now) so expiry shows on screen. */
  real: RealUsage | null
  /** Real percentage samples kept locally (at most one per minute), oldest first. */
  history: UsageSample[]
  load: () => Promise<void>
  loadHistory: () => Promise<void>
  loadReal: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set, get) => {
  // Live token usage is pushed from main as the JSONL transcripts grow; the real
  // numbers are pushed as the capture file changes.
  if (typeof window !== 'undefined' && window.dockterm) {
    window.dockterm.on('usage:changed', (snap) => set({ snapshot: snap }))
    window.dockterm.on('usage:real', (real) => set({ real: reduceReal(get().real, real) }))
  }
  const loadReal = async (): Promise<void> => {
    const r = await window.dockterm.invoke('usage:realGet', undefined)
    if (r.ok) set({ real: reduceReal(get().real, r.value) })
  }
  let historyAt = 0
  const loadHistory = async (): Promise<void> => {
    if (Date.now() - historyAt < 10_000) return
    historyAt = Date.now()
    const r = await window.dockterm.invoke('usageHistory:get', { hours: 24 })
    if (r.ok) set({ history: r.value })
  }
  return {
    snapshot: null,
    real: null,
    history: [],
    loadReal,
    loadHistory,
    load: async () => {
      void loadReal()
      const r = await window.dockterm.invoke('usage:get', undefined)
      if (r.ok) set({ snapshot: r.value })
    }
  }
})
