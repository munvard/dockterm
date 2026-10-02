import { useAgentStore } from './useAgentStore'
import { busyLeaves, useMunuStore } from './useMunuStore'

/** True when both records hold exactly the same keys (count alone misses one pane
 * closing while another opens). */
export function sameKeys(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => k in b)
}

export interface DelegatedDeps {
  paneSessionId: (leafId: string) => string | null
  onPaneSessionChange: (fn: () => void) => () => void
}

/** Keeps useMunuStore.busy in step with the agent snapshot; returns the unsubscribe. */
export function startMunuDelegatedWith(deps: DelegatedDeps): () => void {
  const sync = (): void => {
    const leafIds = Object.keys(useMunuStore.getState().panes)
    useMunuStore.getState().setBusyLeaves(busyLeaves(leafIds, useAgentStore.getState().activity?.busyPtys, deps.paneSessionId))
  }
  sync()
  const offAgents = useAgentStore.subscribe((s, p) => {
    if (s.activity?.busyPtys !== p.activity?.busyPtys) sync()
  })
  const offPanes = useMunuStore.subscribe((s, p) => {
    if (s.panes !== p.panes && !sameKeys(s.panes, p.panes)) sync()
  })
  // A pane's shell restarting (new pty id, same leaf) changes the pty-to-leaf map
  // without touching the pane list or the busy pty list.
  const offSessions = deps.onPaneSessionChange(sync)
  return () => {
    offAgents()
    offPanes()
    offSessions()
  }
}
