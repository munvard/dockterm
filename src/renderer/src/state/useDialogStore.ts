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

export interface ChoiceOption {
  value: string
  label: string
  kind?: 'primary' | 'ghost' | 'danger'
}

/** A dialog with any number of buttons. The FIRST choice is focused (the
 * default); Esc / clicking outside resolves to `dismissValue`. */
export interface ChoiceOptions {
  title: string
  message: string
  detail?: string
  choices: ChoiceOption[]
  dismissValue: string
}

interface DialogState {
  choiceState: (ChoiceOptions & { resolve: (value: string) => void }) | null
  confirmState: (ConfirmOptions & { resolve: (value: boolean) => void }) | null
  promptState: (PromptOptions & { resolve: (value: string | null) => void }) | null
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
  choose: (options: ChoiceOptions) => Promise<string>
  resolveChoice: (value: string) => void
  resolveConfirm: (value: boolean) => void
  resolvePrompt: (value: string | null) => void
}

type QueuedDialog =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: 'choice'; options: ChoiceOptions; resolve: (value: string) => void }

const busy = (s: { confirmState: unknown; promptState: unknown; choiceState: unknown }): boolean =>
  !!(s.confirmState || s.promptState || s.choiceState)

// Only one dialog is ever shown at a time (they share the same Modal and take
// the keyboard). A second confirm()/prompt() while one is already up used to
// just overwrite confirmState/promptState, silently dropping the first
// caller's promise forever — it never resolved. Queue it instead and show it
// once the current dialog is answered.
const queue: QueuedDialog[] = []

export const useDialogStore = create<DialogState>((set, get) => ({
  confirmState: null,
  promptState: null,
  choiceState: null,
  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      if (busy(get())) {
        queue.push({ kind: 'confirm', options, resolve })
        return
      }
      set({ confirmState: { ...options, resolve } })
    }),
  prompt: (options) =>
    new Promise<string | null>((resolve) => {
      if (busy(get())) {
        queue.push({ kind: 'prompt', options, resolve })
        return
      }
      set({ promptState: { ...options, resolve } })
    }),
  choose: (options) =>
    new Promise<string>((resolve) => {
      if (busy(get())) {
        queue.push({ kind: 'choice', options, resolve })
        return
      }
      set({ choiceState: { ...options, resolve } })
    }),
  resolveChoice: (value) => {
    const state = get().choiceState
    if (state) {
      state.resolve(value)
      set({ choiceState: null })
      showNext(set)
    }
  },
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
  else if (next.kind === 'choice') set({ choiceState: { ...next.options, resolve: next.resolve } })
  else set({ promptState: { ...next.options, resolve: next.resolve } })
}
