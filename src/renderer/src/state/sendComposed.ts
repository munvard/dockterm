import { paneWriters } from './paneWriters'
import { sendPrompt } from './sendPrompt'
import { useToastStore } from './useToastStore'
import { paneVisibleText } from '../components/terminal/terminalPool'
import { paneClaudeForeground } from '../components/terminal/paneClaudeActive'
import { detectPlatform } from '../hooks/keys'
import { clearClaudeInputWith, sendComposedWith, type ComposedInput, type SendDeps } from './composedSend'
import { setSending } from './launchTracker'
import { parseClaudeInputBox } from '../components/terminal/claudeInputBox'
import type { ComposerPlatform } from '../components/chat/composerText'

export function composerPlatform(): ComposerPlatform {
  const p = detectPlatform()
  return p === 'mac' ? 'darwin' : p === 'win' ? 'win32' : 'linux'
}

/** The text typed in a pane's Claude input box ('' empty, null = no box on screen). */
export const paneClaudeInput = (leafId: string): string | null => parseClaudeInputBox(paneVisibleText(leafId))

const realDeps = (): SendDeps => ({
  bracketedPaste: (id) => paneWriters.bracketedPaste(id),
  write: (id, text) => paneWriters.write(id, text),
  visibleText: paneVisibleText,
  claudeInput: paneClaudeInput,
  sendPrompt: (id, text) => sendPrompt(id, text, () => paneClaudeForeground(id)),
  isClaude: paneClaudeForeground,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  warn: (m) => useToastStore.getState().push(m, 'warning')
})

/** Send a composed prompt (text, pasted chips, attachments) to a pane's Claude. */
export function sendComposed(leafId: string, input: Omit<ComposedInput, 'platform'>): Promise<boolean> {
  setSending(leafId, true)
  return sendComposedWith(realDeps(), leafId, { ...input, platform: composerPlatform() }).finally(() =>
    setSending(leafId, false)
  )
}

/** Empty Claude's own input box (Ctrl+U until it is clear). False when it will not clear. */
export function clearClaudeInput(leafId: string): Promise<boolean> {
  setSending(leafId, true)
  return clearClaudeInputWith(realDeps(), leafId).finally(() => setSending(leafId, false))
}
