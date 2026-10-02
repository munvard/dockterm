import type { MunuState } from './types'

const PRIORITY: MunuState[] = ['done', 'asking', 'working', 'idle']

/** Combine many panes'/windows' states into one, by attention priority. */
export function aggregate(states: MunuState[]): MunuState {
  for (const p of PRIORITY) if (states.includes(p)) return p
  return 'idle'
}

/**
 * One pane's state for munu. The screen alone cannot tell that Claude is waiting on
 * its sub-agents, background agents or teammates (its prompt can look idle), so
 * `delegated` (Claude Code's own busy flag for that pane, or a running agent it
 * started) keeps the pane working. A question on screen still wins.
 */
export function effectivePaneState(screen: MunuState, delegated: boolean): MunuState {
  if (screen === 'asking') return 'asking'
  return screen === 'working' || delegated ? 'working' : 'idle'
}

/**
 * Like `aggregate`, for agents not tied to a pane. `unplaced` are running agents of
 * Claude sessions not matched to a pane yet: one of them may belong to the pane
 * that just went quiet, so they also hold back a "done" smile. `outside` are agents
 * of Claude sessions running outside DockTerm: they only turn idle into working.
 * Asking still wins.
 */
export function aggregateWithAgents(states: MunuState[], unplaced: number, outside = 0): MunuState {
  const base = unplaced > 0 ? aggregate(states.filter((s) => s !== 'done')) : aggregate(states)
  return base === 'idle' && unplaced + outside > 0 ? 'working' : base
}
