import { create } from 'zustand'

/** Hover-preview target: which file path to peek and where the cursor is.
 *
 * Showing is delayed so quick mouse passes don't flash cards. Hiding is ALSO
 * delayed (a short grace period) so the cursor can travel from the link onto the
 * card without it vanishing — the card cancels the pending hide on mouse-enter. */
interface PreviewState {
  path: string | null
  anchor: { x: number; y: number }
  requestShow: (relPath: string, x: number, y: number) => void
  /** Close after a short grace period (cursor left the link). */
  scheduleHide: () => void
  /** Cursor entered the card — cancel the pending close. */
  keepOpen: () => void
  /** Close immediately. */
  hide: () => void
}

let showTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
const clearShow = (): void => {
  if (showTimer) clearTimeout(showTimer)
  showTimer = undefined
}
const clearHide = (): void => {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = undefined
}

export const useFilePreviewStore = create<PreviewState>((set, get) => ({
  path: null,
  anchor: { x: 0, y: 0 },
  requestShow: (relPath, x, y) => {
    clearHide() // re-entering a link cancels a pending close
    if (get().path === relPath) {
      set({ anchor: { x, y } })
      return
    }
    clearShow()
    showTimer = setTimeout(() => set({ path: relPath, anchor: { x, y } }), 380)
  },
  scheduleHide: () => {
    clearShow()
    clearHide()
    hideTimer = setTimeout(() => set({ path: null }), 220)
  },
  keepOpen: () => clearHide(),
  hide: () => {
    clearShow()
    clearHide()
    set({ path: null })
  }
}))
