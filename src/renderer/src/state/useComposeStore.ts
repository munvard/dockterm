import { create } from 'zustand'
import { useWorkspaceStore } from './useWorkspaceStore'
import { pastedToken, type Attachment, type PastedChip } from '../components/chat/composerText'
import { pushHistory } from '../components/chat/promptHistory'

/** The focused pane's leaf id (the terminal a composed prompt is sent to). */
function focusedLeaf(): string | null {
  const { tabs, activeId } = useWorkspaceStore.getState()
  return tabs.find((t) => t.id === activeId)?.focusedLeafId ?? null
}

function revoke(a: Attachment): void {
  if (a.thumb?.startsWith('blob:')) URL.revokeObjectURL(a.thumb)
}

interface ComposeState {
  open: boolean
  /** Which pane the current compose targets (captured on open). */
  leafId: string | null
  /** In-progress prompt text, kept per leaf so reopening restores the draft. The
   * chat composer and the big Compose editor share it. */
  drafts: Record<string, string>
  /** Images / files / folders attached to a pane's draft. */
  attachments: Record<string, Attachment[]>
  /** Large pastes held as chips; the draft holds their `[Pasted text #N]` token. */
  chips: Record<string, PastedChip[]>
  /** Sent prompts per pane, oldest first (last 100), for Up / Down recall. */
  history: Record<string, string[]>
  openCompose: () => void
  close: () => void
  setDraft: (text: string) => void
  setDraftFor: (leafId: string, text: string) => void
  clearDraft: (leafId: string) => void
  addAttachments: (leafId: string, items: Attachment[]) => void
  removeAttachment: (leafId: string, id: string) => void
  addChip: (leafId: string, text: string) => PastedChip
  updateChip: (leafId: string, id: number, text: string) => void
  /** Drop the chip and its token from the draft. */
  removeChip: (leafId: string, id: number) => void
  recordHistory: (leafId: string, text: string) => void
  /** After a send: draft, attachments and chips are gone (history stays). */
  clearComposer: (leafId: string) => void
}

let chipCounter = 0

export const useComposeStore = create<ComposeState>((set, get) => ({
  open: false,
  leafId: null,
  drafts: {},
  attachments: {},
  chips: {},
  history: {},
  openCompose: () => {
    const leafId = focusedLeaf()
    if (!leafId) return
    set({ open: true, leafId })
  },
  close: () => set({ open: false }),
  setDraft: (text) => {
    const id = get().leafId
    if (!id) return
    get().setDraftFor(id, text)
  },
  setDraftFor: (leafId, text) => set((s) => ({ drafts: { ...s.drafts, [leafId]: text } })),
  clearDraft: (leafId) =>
    set((s) => {
      const next = { ...s.drafts }
      delete next[leafId]
      return { drafts: next }
    }),
  addAttachments: (leafId, items) =>
    set((s) => {
      const have = s.attachments[leafId] ?? []
      const fresh = items.filter((n) => !have.some((a) => a.kind === n.kind && a.path === n.path))
      for (const dup of items) if (!fresh.includes(dup)) revoke(dup)
      return { attachments: { ...s.attachments, [leafId]: [...have, ...fresh] } }
    }),
  removeAttachment: (leafId, id) =>
    set((s) => {
      const have = s.attachments[leafId] ?? []
      have.filter((a) => a.id === id).forEach(revoke)
      return { attachments: { ...s.attachments, [leafId]: have.filter((a) => a.id !== id) } }
    }),
  addChip: (leafId, text) => {
    const chip: PastedChip = { id: ++chipCounter, text }
    set((s) => ({ chips: { ...s.chips, [leafId]: [...(s.chips[leafId] ?? []), chip] } }))
    return chip
  },
  updateChip: (leafId, id, text) =>
    set((s) => ({
      chips: { ...s.chips, [leafId]: (s.chips[leafId] ?? []).map((c) => (c.id === id ? { ...c, text } : c)) }
    })),
  removeChip: (leafId, id) =>
    set((s) => {
      const token = pastedToken(id)
      const draft = s.drafts[leafId]
      return {
        chips: { ...s.chips, [leafId]: (s.chips[leafId] ?? []).filter((c) => c.id !== id) },
        drafts: draft !== undefined ? { ...s.drafts, [leafId]: draft.split(token).join('') } : s.drafts
      }
    }),
  recordHistory: (leafId, text) =>
    set((s) => ({ history: { ...s.history, [leafId]: pushHistory(s.history[leafId] ?? [], text) } })),
  clearComposer: (leafId) =>
    set((s) => {
      ;(s.attachments[leafId] ?? []).forEach(revoke)
      const drafts = { ...s.drafts }
      delete drafts[leafId]
      return {
        drafts,
        attachments: { ...s.attachments, [leafId]: [] },
        chips: { ...s.chips, [leafId]: [] }
      }
    })
}))
