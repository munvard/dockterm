import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { allLeaves } from '../../state/layout'
import type { LiveTerminalCount } from '../../state/projectSwitch'
import { paneSessionId } from './terminalPool'
import { paneClaudeActive } from './paneClaudeActive'

/** Every pane in this window that has a live PTY, and how many of those are
 * running something other than a shell prompt. */
export async function countLiveTerminals(): Promise<LiveTerminalCount> {
  const ids: string[] = []
  for (const tab of useWorkspaceStore.getState().tabs) {
    for (const leaf of allLeaves(tab.layout)) {
      if (paneSessionId(leaf.id)) ids.push(leaf.id)
    }
  }
  const active = await Promise.all(ids.map((id) => paneClaudeActive(id)))
  return { terminals: ids.length, claude: active.filter(Boolean).length }
}
