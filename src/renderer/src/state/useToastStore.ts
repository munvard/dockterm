import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

interface ToastState {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
  /** Cancel the auto-dismiss timer while the pointer is over a toast. */
  pause: (id: number) => void
  /** Restart the auto-dismiss timer after the pointer leaves a toast. */
  resume: (id: number) => void
}

const DURATION_MS = 4200
/** Cap the stack so a burst of errors can't pile the whole screen up — the
 * oldest toast is dropped (and its timer cleared) once a new one exceeds this. */
const MAX_TOASTS = 4

let counter = 0
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function clearTimer(id: number): void {
  const t = timers.get(id)
  if (t) clearTimeout(t)
  timers.delete(id)
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, kind = 'info') => {
    const id = ++counter
    set((s) => {
      const toasts = [...s.toasts, { id, message, kind }]
      if (toasts.length > MAX_TOASTS) {
        for (const dropped of toasts.splice(0, toasts.length - MAX_TOASTS)) clearTimer(dropped.id)
      }
      return { toasts }
    })
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        get().dismiss(id)
      }, DURATION_MS)
    )
  },
  dismiss: (id) => {
    clearTimer(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
  pause: (id) => clearTimer(id),
  resume: (id) => {
    if (!get().toasts.some((t) => t.id === id)) return
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        get().dismiss(id)
      }, DURATION_MS)
    )
  }
}))
