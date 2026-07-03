import { paneSessionId, paneBufferType } from './terminalPool'
import { isShellProcess } from './closeGuard'

/**
 * Is Claude (or any real program) running in this pane? Since v0.29.4 Claude
 * renders inline on the NORMAL buffer, so the old `alternate`-buffer check is no
 * longer sufficient. We treat a pane as active when it's on the alternate buffer
 * (fullscreen Claude / vim) OR its pty foreground process isn't a plain shell
 * (inline Claude, node, etc.). Used to keep the session binding sticky.
 */
export async function paneClaudeActive(leafId: string): Promise<boolean> {
  if (paneBufferType(leafId) === 'alternate') return true
  const sid = paneSessionId(leafId)
  if (!sid) return false
  const res = await window.dockterm.invoke('pty:foreground', { sessionId: sid })
  return res.ok ? !isShellProcess(res.value.process) : false
}
