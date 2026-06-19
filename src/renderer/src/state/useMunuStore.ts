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
  /** Called the instant munu answers a prompt: optimistically clear the pane's
   * 'asking' state (so the card closes immediately) and briefly ignore the stale
   * menu the classifier still sees in the buffer. */
  markAnswered: (leafId: string) => void
  munuState: () => MunuState
  /** This window's aggregate + asking panes, for reporting to main. `activeTabId`
   * + `focused` let each ask carry whether the user can currently see it. */
  snapshot: (activeTabId: string, focused: boolean) => MunuGlobal
}

// How long working→idle must hold before we flash 'done' — long enough to skip
// the brief working↔idle flickers between tool calls, short enough that finishing
// feels immediate (was 3s, which read as a lag).
const DONE_DETECT_MS = 1400
// How long the 'done' glow stays lit once shown.
const DONE_FLASH_MS = 2600
// How long after answering to ignore the just-answered menu still lingering in
// the terminal buffer (it scrolls out over ~1-2s). A DIFFERENT prompt within
// this window is never suppressed — only the identical, stale one.
const SUPPRESS_MS = 2500
const timers: Record<string, ReturnType<typeof setTimeout>> = {}
/** leafId -> the signature + time of the prompt munu just answered. */
const answeredAt: Record<string, { sig: string; at: number }> = {}

/** Content signature of a prompt, to tell a stale menu from a genuinely new one. */
function askSig(ask: AskInfo | null): string {
  return ask ? `${ask.title ?? ''}${ask.options.join('')}` : ''
}

export const useMunuStore = create<MunuStore>((set, get) => ({
  panes: {},
  done: {},

  setPaneStatus: (leafId, tabId, state, ask) => {
    // After an answer, the classifier still sees the old menu in the buffer for a
    // moment. Ignore that stale 'asking' (same signature, within the window) so
    // the card doesn't pop back open; a different prompt clears the suppression.
    const ans = answeredAt[leafId]
    if (ans) {
      if (state === 'asking' && Date.now() - ans.at < SUPPRESS_MS && askSig(ask) === ans.sig) {
        state = 'working'
        ask = null
      } else {
        delete answeredAt[leafId]
      }
    }
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
        setTimeout(() => set((s) => ({ done: { ...s.done, [leafId]: false } })), DONE_FLASH_MS)
      }, DONE_DETECT_MS)
    }
    set((s) => ({ panes: { ...s.panes, [leafId]: { state, ask, tabId } } }))
  },

  removePane: (leafId) =>
    set((s) => {
      if (timers[leafId]) {
        clearTimeout(timers[leafId])
        delete timers[leafId]
      }
      delete answeredAt[leafId]
      const panes = { ...s.panes }
      const done = { ...s.done }
      delete panes[leafId]
      delete done[leafId]
      return { panes, done }
    }),

  markAnswered: (leafId) => {
    const pane = get().panes[leafId]
    if (!pane) return
    answeredAt[leafId] = { sig: askSig(pane.ask), at: Date.now() }
    if (timers[leafId]) {
      clearTimeout(timers[leafId])
      delete timers[leafId]
    }
    // Optimistically leave 'asking' so the card closes + munu tucks immediately;
    // the classifier re-confirms the real state (working/idle) momentarily.
    set((s) => ({ panes: { ...s.panes, [leafId]: { ...pane, state: 'working', ask: null } } }))
  },

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
