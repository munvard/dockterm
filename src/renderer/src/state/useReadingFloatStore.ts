import { create } from 'zustand'

interface ReadingFloatState {
  pos: { x: number; y: number } | null
  size: { w: number; h: number } | null
  setPos: (p: { x: number; y: number }) => void
  setSize: (s: { w: number; h: number }) => void
}

export const useReadingFloatStore = create<ReadingFloatState>((set) => ({
  pos: null,
  size: null,
  setPos: (pos) => set({ pos }),
  setSize: (size) => set({ size })
}))
