import { useDialogStore } from '../../state/useDialogStore'
import { paneSessionId } from './terminalPool'

/** Login shells / interactive shells — closing one of these loses nothing. */
const SHELLS = new Set([
  'zsh',
  'bash',
  'sh',
  'fish',
  'dash',
  'ksh',
  'tcsh',
  'csh',
  'pwsh',
  'powershell',
  'nu',
  'xonsh',
  'cmd'
])

/** The live foreground process in a pane (e.g. 'node'/'claude'/'vim'), or null
 * when it's just sitting at a shell prompt. Robust against Claude being idle —
 * it reports the running process regardless of on-screen state. */
async function liveProcess(leafId: string): Promise<string | null> {
  const sid = paneSessionId(leafId)
  if (!sid) return null
  const res = await window.dockterm.invoke('pty:foreground', { sessionId: sid })
  if (!res.ok) return null
  const raw = res.value.process
  const name = raw
    .replace(/^-/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase()
  return name && !SHELLS.has(name) ? raw : null
}

/**
 * Ask before closing terminals that still have a live process (a running Claude
 * Code session, an editor, a build…). Returns true to proceed with the close,
 * false to keep it open. Closing a plain shell prompt never prompts.
 */
export async function confirmCloseLeaves(leafIds: string[]): Promise<boolean> {
  for (const id of leafIds) {
    const proc = await liveProcess(id)
    if (proc) {
      return useDialogStore.getState().confirm({
        title: 'Close this terminal?',
        message: `“${proc}” is still running here.`,
        detail:
          'Closing the terminal stops it — a running Claude session or unsaved work would be lost.',
        confirmLabel: 'Close anyway',
        cancelLabel: 'Keep open',
        danger: true
      })
    }
  }
  return true
}
