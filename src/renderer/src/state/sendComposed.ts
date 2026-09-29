import { paneWriters } from './paneWriters'
import { sendPrompt } from './sendPrompt'
import { useToastStore } from './useToastStore'
import { paneVisibleText } from '../components/terminal/terminalPool'
import { paneClaudeForeground } from '../components/terminal/paneClaudeActive'
import { detectPlatform } from '../hooks/keys'
import { sendComposedWith, type ComposedInput } from './composedSend'
import type { ComposerPlatform } from '../components/chat/composerText'

export function composerPlatform(): ComposerPlatform {
  const p = detectPlatform()
  return p === 'mac' ? 'darwin' : p === 'win' ? 'win32' : 'linux'
}

/** Send a composed prompt (text, pasted chips, attachments) to a pane's Claude. */
export function sendComposed(leafId: string, input: Omit<ComposedInput, 'platform'>): Promise<boolean> {
  return sendComposedWith(
    {
      bracketedPaste: (id) => paneWriters.bracketedPaste(id),
      write: (id, text) => paneWriters.write(id, text),
      visibleText: paneVisibleText,
      sendPrompt: (id, text) => sendPrompt(id, text, () => paneClaudeForeground(id)),
      isClaude: paneClaudeForeground,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      warn: (m) => useToastStore.getState().push(m, 'warning')
    },
    leafId,
    { ...input, platform: composerPlatform() }
  )
}
