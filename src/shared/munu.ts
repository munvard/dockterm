import type { MunuState } from './types'

const PRIORITY: MunuState[] = ['done', 'asking', 'working', 'idle']

/** Combine many panes'/windows' states into one, by attention priority. */
export function aggregate(states: MunuState[]): MunuState {
  for (const p of PRIORITY) if (states.includes(p)) return p
  return 'idle'
}

/**
 * Like `aggregate`, but a still-running background agent or team member keeps munu
 * "working" when every pane is otherwise idle (asking and done still win).
 */
export function aggregateWithAgents(states: MunuState[], agentsRunning: number): MunuState {
  const base = aggregate(states)
  return base === 'idle' && agentsRunning > 0 ? 'working' : base
}
