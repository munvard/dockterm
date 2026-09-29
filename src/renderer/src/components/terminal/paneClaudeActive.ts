import { paneSessionId, paneBufferType, paneVisibleText } from './terminalPool'
import { isShellProcess } from './closeGuard'
import { claudeIsForeground, claudeOnScreen } from './paneLiveness'

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
 * Claude counts as active when it is working, asking, or idle at its input box
 * (an idle Claude is exactly when the user wants to type). A bare shell prompt
 * never matches.
 */
export async function paneClaudeActive(leafId: string): Promise<boolean> {
  if (paneBufferType(leafId) === 'alternate') return true
  const sid = paneSessionId(leafId)
  if (!sid) return false
  const res = await window.dockterm.invoke('pty:foreground', { sessionId: sid })
  if (!res.ok) return false
  if (res.value.process === '') {
    return claudeOnScreen(paneVisibleText(leafId))
  }
  return !isShellProcess(res.value.process)
}

/**
 * The strict question the composer and voice ask before typing into a pane:
 * is Claude REALLY the foreground program? Uses the pty's foreground process
 * (where the platform reports it) AND what is on screen; unknown means no.
 * Call it again right before each write: a poll result can be seconds old.
 */
export async function paneClaudeForeground(leafId: string): Promise<boolean> {
  const sid = paneSessionId(leafId)
  if (!sid) return false
  let proc: string | null = null
  try {
    const res = await window.dockterm.invoke('pty:foreground', { sessionId: sid })
    if (res.ok) proc = res.value.process
  } catch {
    proc = null
  }
  return claudeIsForeground(proc, paneVisibleText(leafId), isShellProcess)
}
