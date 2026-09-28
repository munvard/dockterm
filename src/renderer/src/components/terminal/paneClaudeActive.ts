import { paneSessionId, paneBufferType, paneVisibleText } from './terminalPool'
import { isShellProcess } from './closeGuard'
import { classify } from './claudeStatus'

/**
 * Is Claude (or any real program) running in this pane? Since v0.29.4 Claude
 * renders inline on the NORMAL buffer, so the old `alternate`-buffer check is no
 * longer sufficient. We treat a pane as active when it's on the alternate buffer
 * (fullscreen Claude / vim) OR its pty foreground process isn't a plain shell
 * (inline Claude, node, etc.). Used to keep the session binding sticky.
 *
 * Windows can't report a real foreground process: node-pty's conpty backend
 * just echoes back the name it was spawned with, never the live process (see
 * ptyService.ts's `foregroundProcess`), so `pty:foreground` resolves to '' on
 * win32. In that case we fall back to classifying the on-screen buffer text:
 * only 'working'/'asking' counts as active. We never optimistically say "active"
 * for a prompt we can't actually identify.
 */
export async function paneClaudeActive(leafId: string): Promise<boolean> {
  if (paneBufferType(leafId) === 'alternate') return true
  const sid = paneSessionId(leafId)
  if (!sid) return false
  const res = await window.dockterm.invoke('pty:foreground', { sessionId: sid })
  if (!res.ok) return false
  if (res.value.process === '') {
    const state = classify(paneVisibleText(leafId))
    return state === 'working' || state === 'asking'
  }
  return !isShellProcess(res.value.process)
}
