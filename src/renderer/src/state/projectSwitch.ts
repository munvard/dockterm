import { useDialogStore } from './useDialogStore'
import { basenameOf } from './workspace'

export interface LiveTerminalCount {
  /** Panes with a live PTY. */
  terminals: number
  /** Of those, panes running something other than a shell prompt (Claude, …). */
  claude: number
}

export type SwitchDecision = 'proceed' | 'new-window' | 'cancel'

/** Registered once at startup (App) by the terminal layer, so this state module
 * never imports xterm. Null until registered: nothing to protect. */
let counter: (() => Promise<LiveTerminalCount>) | null = null

export function setLiveTerminalCounter(fn: (() => Promise<LiveTerminalCount>) | null): void {
  counter = fn
}

export function switchDialogBody(count: LiveTerminalCount): string {
  const n = count.terminals
  return `This window has ${n} ${n === 1 ? 'terminal' : 'terminals'} (${count.claude} running Claude). Opening another project here closes them.`
}

/**
 * Before another project replaces this window's workspace, check whether that
 * would kill live terminals. No live PTY: 'proceed' with no dialog. Otherwise ask;
 * the default (first, focused) answer is a new window, so nothing is killed.
 * Esc / clicking outside is Cancel.
 */
export async function askProjectSwitch(path: string): Promise<SwitchDecision> {
  if (!counter) return 'proceed'
  const count = await counter()
  if (count.terminals === 0) return 'proceed'
  const choice = await useDialogStore.getState().choose({
    title: `Open ${basenameOf(path) || path}?`,
    message: switchDialogBody(count),
    choices: [
      { value: 'new-window', label: 'Open in new window', kind: 'primary' },
      { value: 'replace', label: 'Replace', kind: 'danger' },
      { value: 'cancel', label: 'Cancel', kind: 'ghost' }
    ],
    dismissValue: 'cancel'
  })
  return choice === 'new-window' ? 'new-window' : choice === 'replace' ? 'proceed' : 'cancel'
}

/** Same folder, ignoring case-insensitive-filesystem-agnostic details: only
 * separators and a trailing slash are normalized, so a genuinely different
 * path is never mistaken for the open project. */
export function isSameProjectPath(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm(a) === norm(b)
}
