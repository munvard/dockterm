import { create } from 'zustand'
import { useWorkspaceStore } from './useWorkspaceStore'

/** The focused pane's leaf id (the terminal a composed prompt is sent to). */
function focusedLeaf(): string | null {
  const { tabs, activeId } = useWorkspaceStore.getState()
  return tabs.find((t) => t.id === activeId)?.focusedLeafId ?? null
}

interface ComposeState {
  open: boolean
  /** Which pane the current compose targets (captured on open). */
  leafId: string | null
  /** In-progress prompt text, kept per leaf so reopening restores the draft. */
  drafts: Record<string, string>
  openCompose: () => void
  close: () => void
  setDraft: (text: string) => void
  clearDraft: (leafId: string) => void
}

export const useComposeStore = create<ComposeState>((set, get) => ({
  open: false,
  leafId: null,
  drafts: {},
  openCompose: () => {
    const leafId = focusedLeaf()
    if (!leafId) return
    set({ open: true, leafId })
  },
  close: () => set({ open: false }),
  setDraft: (text) => {
    const id = get().leafId
    if (!id) return
    set((s) => ({ drafts: { ...s.drafts, [id]: text } }))
  },
  clearDraft: (leafId) =>
    set((s) => {
      const next = { ...s.drafts }
      delete next[leafId]
      return { drafts: next }
    })
}))
