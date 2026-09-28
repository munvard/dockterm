import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Exact underlying command shown verbatim for destructive actions. */
  command?: string
}

export interface PromptOptions {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
}

interface DialogState {
  confirmState: (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  promptState: (PromptOptions & { resolve: (value: string | null) => void }) | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  resolveConfirm: (value: boolean) => void
  resolvePrompt: (value: string | null) => void
}

type QueuedDialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

// Only one dialog is ever shown at a time (they share the same Modal and take
// the keyboard). A second confirm()/prompt() while one is already up used to
// just overwrite confirmState/promptState, silently dropping the first
// caller's promise forever — it never resolved. Queue it instead and show it
// once the current dialog is answered.
const queue: QueuedDialog[] = []

export const useDialogStore = create<DialogState>((set, get) => ({
  confirmState: null,
  promptState: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      if (get().confirmState || get().promptState) {
        queue.push({ kind: 'confirm', options, resolve })
        return
      }
      set({ confirmState: { ...options, resolve } })
    }),
  prompt: (options) =>
    new Promise<string | null>((resolve) => {
      if (get().confirmState || get().promptState) {
        queue.push({ kind: 'prompt', options, resolve })
        return
      }
      set({ promptState: { ...options, resolve } })
    }),
  resolveConfirm: (value) => {
    const state = get().confirmState
    if (state) {
      state.resolve(value)
      set({ confirmState: null })
      showNext(set)
    }
  },
  resolvePrompt: (value) => {
    const state = get().promptState
    if (state) {
      state.resolve(value)
      set({ promptState: null })
      showNext(set)
    }
  }
}))

function showNext(set: (partial: Partial<DialogState>) => void): void {
  const next = queue.shift()
  if (!next) return
  if (next.kind === 'confirm') set({ confirmState: { ...next.options, resolve: next.resolve } })
  else set({ promptState: { ...next.options, resolve: next.resolve } })
}
