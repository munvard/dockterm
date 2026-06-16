// 'done' is a transient celebration state derived in the store (idle→done settle).
export type MunuState = 'idle' | 'working' | 'asking' | 'done'

const PRIORITY: MunuState[] = ['done', 'asking', 'working', 'idle']

/** Combine many panes' states into one, by attention priority. */
export function aggregate(states: MunuState[]): MunuState {
  for (const p of PRIORITY) if (states.includes(p)) return p
  return 'idle'
}
