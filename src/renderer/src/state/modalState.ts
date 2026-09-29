import { useDialogStore } from './useDialogStore'

/** How many <Modal>s are mounted right now (UpdatePopup, dialogs, ...). */
let openModals = 0

export const modalRegistry = {
  enter(): void {
    openModals++
  },
  leave(): void {
    openModals = Math.max(0, openModals - 1)
  }
}

/** True while something modal owns the keyboard: a mounted <Modal> or the
 * Compose overlay (both register with modalRegistry), or a queued
 * confirm/prompt/choice dialog (set a render before its Modal mounts). Global
 * shortcuts must not act on the app underneath. */
export function isModalOpen(): boolean {
  const d = useDialogStore.getState()
  return openModals > 0 || !!(d.confirmState || d.promptState || d.choiceState)
}
