import { create } from 'zustand'
import { aggregate, type MunuState } from './munuAggregate'
import { effectivePaneState } from '@shared/munu'
import type { ClaudeState } from '../components/terminal/claudeStatus'
import { askSig } from '../components/terminal/askKeys'
import type { AskInfo, MunuAsk, MunuGlobal } from '@shared/types'

export interface PaneStatus {
  state: ClaudeState
  ask: AskInfo | null
  tabId: string
}

interface MunuStore {
  panes: Record<string, PaneStatus>
  /** transient 'done' flags per leaf, set when working→idle settles */
  done: Record<string, boolean>
  /** leaves whose Claude still waits on sub-agents, background agents or teammates
   * (from main's agent tracker); such a pane is working whatever its screen shows. */
  busy: Record<string, boolean>
  setPaneStatus: (leafId: string, tabId: string, state: ClaudeState, ask: AskInfo | null) => void
  /** Replace the set of busy leaves (only the true ones are kept). */
  setBusyLeaves: (busy: Record<string, boolean>) => void
  removePane: (leafId: string) => void
  /** A pane's state for munu: its screen plus delegated work. */
  paneState: (leafId: string) => MunuState
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

/** Leaves whose pty is in main's busy list (Claude there still has work in flight). */
export function busyLeaves(
  leafIds: readonly string[],
  busyPtys: readonly string[] | undefined,
  ptyOf: (leafId: string) => string | null
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  if (!busyPtys?.length) return out
  const busy = new Set(busyPtys)
  for (const id of leafIds) {
    const pty = ptyOf(id)
    if (pty && busy.has(pty)) out[id] = true
  }
  return out
}

/** True when a re-reported pane status changes nothing anyone can see. */
export function samePaneStatus(a: PaneStatus | undefined, b: PaneStatus): boolean {
  if (!a || a.state !== b.state || a.tabId !== b.tabId) return false
  if (a.ask === b.ask) return true
  if (!a.ask || !b.ask) return false
  return JSON.stringify(a.ask) === JSON.stringify(b.ask)
}

export const useMunuStore = create<MunuStore>((set, get) => {
  const effective = (leafId: string): MunuState => {
    const p = get().panes[leafId]
    return effectivePaneState((p?.state ?? 'idle') as MunuState, !!get().busy[leafId])
  }
  // The done smile follows the pane's EFFECTIVE state: it only flashes after the
  // pane went working to idle and stayed idle (screen quiet AND no running agents)
  // for DONE_DETECT_MS. Any work coming back cancels a pending or lit smile.
  const settle = (leafId: string, before: MunuState): void => {
    const now = effective(leafId)
    if (now === 'idle') {
      if (before !== 'working' || timers[leafId]) return
      timers[leafId] = setTimeout(() => {
        delete timers[leafId]
        if (!get().panes[leafId] || effective(leafId) !== 'idle') return
        set((s) => ({ done: { ...s.done, [leafId]: true } }))
        setTimeout(() => set((s) => (s.done[leafId] ? { done: { ...s.done, [leafId]: false } } : s)), DONE_FLASH_MS)
      }, DONE_DETECT_MS)
      return
    }
    if (timers[leafId]) {
      clearTimeout(timers[leafId])
      delete timers[leafId]
    }
    if (now === 'working' && get().done[leafId]) set((s) => ({ done: { ...s.done, [leafId]: false } }))
  }
  return {
    panes: {},
    done: {},
    busy: {},

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
      const before = effective(leafId)
      // The classifier re-reports every ~100-250 ms while output streams; an
      // identical status must not churn the store (each change re-reports to main).
      if (!samePaneStatus(get().panes[leafId], { state, ask, tabId })) {
        set((s) => ({ panes: { ...s.panes, [leafId]: { state, ask, tabId } } }))
      }
      settle(leafId, before)
    },

    setBusyLeaves: (next) => {
      const cur = get().busy
      const keys = new Set([...Object.keys(cur), ...Object.keys(next)])
      const changed = [...keys].filter((k) => !!cur[k] !== !!next[k])
      if (changed.length === 0) return
      const before = Object.fromEntries(changed.map((k) => [k, effective(k)]))
      const busy: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(next)) if (v) busy[k] = true
      set({ busy })
      for (const k of changed) if (get().panes[k]) settle(k, before[k])
    },

    paneState: (leafId) => effective(leafId),

    removePane: (leafId) =>
      set((s) => {
        if (timers[leafId]) {
          clearTimeout(timers[leafId])
          delete timers[leafId]
        }
        delete answeredAt[leafId]
        const panes = { ...s.panes }
        const done = { ...s.done }
        const busy = { ...s.busy }
        delete panes[leafId]
        delete done[leafId]
        delete busy[leafId]
        return { panes, done, busy }
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
      const states: MunuState[] = Object.keys(panes).map((id) => (done[id] ? 'done' : effective(id)))
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
          numbered: p.ask?.numbered ?? true,
          visible: focused && p.tabId === activeTabId
        }))
      return { state: get().munuState(), asks, activeTabId }
    }
  }
})
