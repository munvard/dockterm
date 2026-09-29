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
  /** Let the confirm button submit an empty (trimmed) value instead of treating
   * it the same as Cancel — for genuinely optional fields (e.g. a checkpoint
   * label). Defaults to false, preserving the original required-field behavior. */
  allowEmpty?: boolean
}

interface DialogState {
  confirmState: (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  promptState: (PromptOptions & { resolve: (value: string | null) => void }) | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  resolveConfirm: (value: boolean) => void
  resolvePrompt: (value: string | null) => void
}

export const useDialogStore = create<DialogState>((set, get) => ({
  confirmState: null,
  promptState: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => set({ confirmState: { ...options, resolve } })),
  prompt: (options) =>
    new Promise<string | null>((resolve) => set({ promptState: { ...options, resolve } })),
  resolveConfirm: (value) => {
    const state = get().confirmState
    if (state) {
      state.resolve(value)
      set({ confirmState: null })
    }
  },
  resolvePrompt: (value) => {
    const state = get().promptState
    if (state) {
      state.resolve(value)
      set({ promptState: null })
    }
  }
}))
