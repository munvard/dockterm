import { create } from 'zustand'

/** Position + size of the floating checkpoints card (session-persistent). */
interface HistoryFloatState {
  pos: { x: number; y: number } | null
  size: { w: number; h: number } | null
  setPos: (p: { x: number; y: number }) => void
  setSize: (s: { w: number; h: number }) => void
}

export const useHistoryFloatStore = create<HistoryFloatState>((set) => ({
  pos: null,
  size: null,
  setPos: (pos) => set({ pos }),
  setSize: (size) => set({ size })
}))
