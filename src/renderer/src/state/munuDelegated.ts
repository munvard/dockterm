import { onPaneSessionChange, paneSessionId } from '../components/terminal/terminalPool'
import { startMunuDelegatedWith } from './munuDelegatedCore'

/** Keeps useMunuStore.busy in step with the agent snapshot; returns the unsubscribe. */
export function startMunuDelegated(): () => void {
  return startMunuDelegatedWith({ paneSessionId, onPaneSessionChange })
}
