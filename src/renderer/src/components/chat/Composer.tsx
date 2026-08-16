import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Maximize2, Square } from 'lucide-react'
import { paneWriters } from '../../state/paneWriters'
import { useComposeStore } from '../../state/useComposeStore'
import { wrapBracketedPaste } from '../terminal/terminalSelection'
import { opensPicker, ESC } from '../terminal/askKeys'

/**
 * The prompt box for chat mode. Sends through the SAME bracketed-paste path the
 * Compose overlay uses, so multi-line prompts land in Claude's input intact.
 * Slash commands that open Claude's own picker hand the pane back to the terminal.
 */
export function Composer({
  leafId,
  disabled,
  noClaude = false,
  onSentPicker
}: {
  leafId: string
  disabled: boolean
  /** Claude isn't running in this pane — the pty would run the text as a SHELL
   * command, so input is off and the placeholder says so. */
  noClaude?: boolean
  onSentPicker: () => void
}): React.ReactElement {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Chat mode mounts this fresh every time it opens, so mount-focus is exactly
  // "⌘R put the caret somewhere useful".
  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const send = (): void => {
    const body = text.trim()
    if (!body || disabled) return
    paneWriters.write(leafId, wrapBracketedPaste(body))
    paneWriters.write(leafId, '\r')
    setText('')
    if (opensPicker(body)) onSentPicker()
  }

  return (
    <div className="composer">
      <textarea
        ref={taRef}
        className="composer__input"
        value={text}
        rows={2}
        spellCheck={false}
        disabled={disabled}
        placeholder={
          noClaude
            ? 'Claude isn’t running in this terminal — press ⌘R to use the terminal'
            : disabled
              ? 'Answer Claude above to continue…'
              : 'Message Claude…  ⏎ send · ⇧⏎ newline'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
            e.preventDefault()
            useComposeStore.getState().openCompose()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            paneWriters.write(leafId, ESC) // interrupt Claude
          }
        }}
      />
      <div className="composer__actions">
        <button
          className="iconbtn iconbtn--sm"
          title="Interrupt Claude (Esc)"
          onClick={() => paneWriters.write(leafId, ESC)}
        >
          <Square size={13} />
        </button>
        <button
          className="iconbtn iconbtn--sm"
          title="Open the big editor (⌘⇧⏎)"
          onClick={() => useComposeStore.getState().openCompose()}
        >
          <Maximize2 size={13} />
        </button>
        <button className="btn btn--primary btn--sm" disabled={disabled || !text.trim()} onClick={send}>
          <CornerDownLeft size={13} /> Send
        </button>
      </div>
    </div>
  )
}
