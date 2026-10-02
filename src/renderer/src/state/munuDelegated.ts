import { useAgentStore } from './useAgentStore'
import { busyLeaves, useMunuStore } from './useMunuStore'
import { paneSessionId } from '../components/terminal/terminalPool'

/** Keeps useMunuStore.busy in step with the agent snapshot; returns the unsubscribe. */
export function startMunuDelegated(): () => void {
  const sync = (): void => {
    const leafIds = Object.keys(useMunuStore.getState().panes)
    useMunuStore.getState().setBusyLeaves(busyLeaves(leafIds, useAgentStore.getState().activity?.busyPtys, paneSessionId))
  }
  sync()
  const offAgents = useAgentStore.subscribe((s, p) => {
    if (s.activity?.busyPtys !== p.activity?.busyPtys) sync()
  })
  const offPanes = useMunuStore.subscribe((s, p) => {
    if (s.panes !== p.panes && Object.keys(s.panes).length !== Object.keys(p.panes).length) sync()
  })
  return () => {
    offAgents()
    offPanes()
  }
}
