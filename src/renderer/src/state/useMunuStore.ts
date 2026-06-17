import { create } from 'zustand'
import { aggregate, type MunuState } from './munuAggregate'
import type { ClaudeState } from '../components/terminal/claudeStatus'
import type { AskInfo, MunuAsk, MunuGlobal } from '@shared/types'

interface PaneStatus {
  state: ClaudeState
  ask: AskInfo | null
  tabId: string
}

interface MunuStore {
  panes: Record<string, PaneStatus>
  /** transient 'done' flags per leaf, set when working→idle settles */
  done: Record<string, boolean>
  setPaneStatus: (leafId: string, tabId: string, state: ClaudeState, ask: AskInfo | null) => void
  removePane: (leafId: string) => void
  munuState: () => MunuState
  /** This window's aggregate + asking panes, for reporting to main. `activeTabId`
   * + `focused` let each ask carry whether the user can currently see it. */
  snapshot: (activeTabId: string, focused: boolean) => MunuGlobal
}

const SETTLE_MS = 3000
const timers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useMunuStore = create<MunuStore>((set, get) => ({
  panes: {},
  done: {},

  setPaneStatus: (leafId, tabId, state, ask) => {
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
    set((s) => ({ panes: { ...s.panes, [leafId]: { state, ask, tabId } } }))
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
  },

  snapshot: (activeTabId, focused) => {
    const { panes } = get()
    const asks: MunuAsk[] = Object.entries(panes)
      .filter(([, p]) => p.state === 'asking')
      .map(([leafId, p]) => ({
        leafId,
        tabId: p.tabId,
        title: p.ask?.title ?? null,
        options: p.ask?.options ?? [],
        descriptions: p.ask?.descriptions ?? [],
        steps: p.ask?.steps ?? [],
        binary: p.ask?.binary ?? false,
        multiSelect: p.ask?.multiSelect ?? false,
        checkable: p.ask?.checkable ?? [],
        checked: p.ask?.checked ?? [],
        submitIndex: p.ask?.submitIndex ?? null,
        cursorRow: p.ask?.cursorRow ?? 0,
        visible: focused && p.tabId === activeTabId
      }))
    return { state: get().munuState(), asks, activeTabId }
  }
}))
