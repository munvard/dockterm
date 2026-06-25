import { create } from 'zustand'
import type { DiffSinceFile, DiffContent } from '@shared/types'

/**
 * The live "Changes" overlay: files changed since the last commit (what Claude is
 * editing), driven entirely by the existing review IPC. Shared with the hover
 * preview's "changed" badge, so it stays a single source of truth.
 */
interface ChangesState {
  open: boolean
  /** Floating card position (null → default bottom-right) and size (null → auto). */
  pos: { x: number; y: number } | null
  size: { w: number; h: number } | null
  files: DiffSinceFile[]
  /** True once the user closes the card — suppresses auto-reveal until the tree
   * goes clean again (a fresh burst). */
  dismissed: boolean
  /** relPath of the one expanded row (only one at a time, to bound Monaco cost). */
  expanded: string | null
  diffs: Record<string, DiffContent>
  /** Expanded row mode: diff-only (false) vs full file (true). */
  full: boolean
  refresh: () => Promise<void>
  setOpen: (v: boolean) => void
  toggleOpen: () => void
  setPos: (p: { x: number; y: number }) => void
  setSize: (s: { w: number; h: number }) => void
  setFull: (v: boolean) => void
  expand: (relPath: string | null) => Promise<void>
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  open: false,
  pos: null,
  size: null,
  files: [],
  dismissed: false,
  expanded: null,
  diffs: {},
  full: false,
  refresh: async () => {
    const res = await window.dockterm.invoke('review:list', { base: 'working' })
    if (!res.ok) return
    const files = res.value
    const exp = get().expanded
    const stillExpanded = exp && files.some((f) => f.relPath === exp) ? exp : null
    // Diffs are cheap to refetch; drop the cache so an expanded row stays fresh.
    // A clean tree clears the dismissal so the next burst can auto-reveal again.
    set({ files, diffs: {}, expanded: stillExpanded, ...(files.length === 0 ? { dismissed: false } : {}) })
    if (stillExpanded) {
      const d = await window.dockterm.invoke('review:diffFile', { base: 'working', relPath: stillExpanded })
      if (d.ok) set((s) => ({ diffs: { ...s.diffs, [stillExpanded]: d.value } }))
    }
  },
  setOpen: (v) => set({ open: v, dismissed: !v }),
  toggleOpen: () => set((s) => ({ open: !s.open, dismissed: s.open })),
  setPos: (p) => set({ pos: p }),
  setSize: (sz) => set({ size: sz }),
  setFull: (v) => set({ full: v }),
  expand: async (relPath) => {
    if (relPath === null || get().expanded === relPath) {
      set({ expanded: null })
      return
    }
    set({ expanded: relPath })
    if (!get().diffs[relPath]) {
      const res = await window.dockterm.invoke('review:diffFile', { base: 'working', relPath })
      if (res.ok) set((s) => ({ diffs: { ...s.diffs, [relPath]: res.value } }))
    }
  }
}))
