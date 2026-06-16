import { create } from 'zustand'
import { aggregate, type MunuState } from './munuAggregate'
import type { ClaudeState } from '../components/terminal/claudeStatus'

interface PaneStatus {
  state: ClaudeState
  ask: string | null
}

interface MunuStore {
  panes: Record<string, PaneStatus>
  /** transient 'done' flags per leaf, set when working→idle settles */
  done: Record<string, boolean>
  setPaneStatus: (leafId: string, state: ClaudeState, ask: string | null) => void
  removePane: (leafId: string) => void
  munuState: () => MunuState
}

const SETTLE_MS = 3000
const timers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useMunuStore = create<MunuStore>((set, get) => ({
  panes: {},
  done: {},

  setPaneStatus: (leafId, state, ask) => {
    const prev = get().panes[leafId]?.state
    if (timers[leafId]) {
      clearTimeout(timers[leafId])
      delete timers[leafId]
    }
    // working → idle: after a settle, flash 'done' (avoids false positives from
    // brief working↔idle flickers).
    if (prev === 'working' && state === 'idle') {
      timers[leafId] = setTimeout(() => {
        delete timers[leafId]
        if (get().panes[leafId]?.state !== 'idle') return
        set((s) => ({ done: { ...s.done, [leafId]: true } }))
        setTimeout(() => set((s) => ({ done: { ...s.done, [leafId]: false } })), SETTLE_MS)
      }, SETTLE_MS)
    }
    set((s) => ({ panes: { ...s.panes, [leafId]: { state, ask } } }))
  },

  removePane: (leafId) =>
    set((s) => {
      if (timers[leafId]) {
        clearTimeout(timers[leafId])
        delete timers[leafId]
      }
      const panes = { ...s.panes }
      const done = { ...s.done }
      delete panes[leafId]
      delete done[leafId]
      return { panes, done }
    }),

  munuState: () => {
    const { panes, done } = get()
    const states: MunuState[] = Object.entries(panes).map(([id, p]) =>
      done[id] ? 'done' : (p.state as MunuState)
    )
    return aggregate(states)
  }
}))
