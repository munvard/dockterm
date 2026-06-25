import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, X, CornerDownLeft, ClipboardPaste } from 'lucide-react'
import { useComposeStore } from '../../state/useComposeStore'
import { paneWriters } from '../../state/paneWriters'
import { wrapBracketedPaste } from '../terminal/terminalSelection'

/**
 * A roomy editor for long prompts. Claude Code's own input box can't be
 * scrolled or resized (it owns its TUI), so we write here and inject the text
 * via the same bracketed-paste path the selection toolbar uses.
 *
 * Insert pastes without submitting (review, then press Enter in Claude); Send
 * pastes and submits. ⌘⏎ sends, Esc closes.
 */
export function ComposeOverlay(): React.ReactElement | null {
  const open = useComposeStore((s) => s.open)
  const leafId = useComposeStore((s) => s.leafId)
  const draft = useComposeStore((s) => (s.leafId ? s.drafts[s.leafId] ?? '' : ''))
  const setDraft = useComposeStore((s) => s.setDraft)
  const close = useComposeStore((s) => s.close)
  const clearDraft = useComposeStore((s) => s.clearDraft)
  const [full, setFull] = useState(false)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Focus the editor and drop the caret at the end whenever it opens.
  useEffect(() => {
    if (!open) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    const len = ta.value.length
    ta.setSelectionRange(len, len)
  }, [open])

  // A global Esc closes even if focus has drifted off the textarea.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  if (!open || !leafId) return null

  const hand = (submit: boolean): void => {
    const text = draft
    if (text.length > 0) {
      paneWriters.write(leafId, wrapBracketedPaste(text))
      if (submit) paneWriters.write(leafId, '\r')
    }
    clearDraft(leafId)
    close()
  }

  const lines = draft.length ? draft.split('\n').length : 0
  const chars = draft.length

  return createPortal(
    <div
      className="compose-overlay"
      onMouseDown={(e) => {
        // Click outside only dismisses when there's nothing to lose.
        if (e.target === e.currentTarget && draft.trim() === '') close()
      }}
    >
      <div className={`compose${full ? ' compose--full' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="compose__head">
          <span className="compose__title">Compose → Claude</span>
          <div className="compose__head-actions">
            <button
              className="iconbtn iconbtn--sm"
              title={full ? 'Restore' : 'Full screen'}
              onClick={() => setFull((f) => !f)}
            >
              {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button className="iconbtn iconbtn--sm" title="Close (Esc)" onClick={close}>
              <X size={14} />
            </button>
          </div>
        </div>
        <textarea
          ref={taRef}
          className="compose__editor"
          value={draft}
          spellCheck={false}
          placeholder="Write a long prompt here — no cramped input box. ⌘⏎ to send, Esc to close."
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              hand(true)
            }
          }}
        />
        <div className="compose__foot">
          <span className="compose__count">
            {lines} line{lines === 1 ? '' : 's'} · {chars} char{chars === 1 ? '' : 's'}
          </span>
          <div className="compose__actions">
            <button className="btn btn--ghost btn--sm" onClick={() => hand(false)} disabled={!draft.length}>
              <ClipboardPaste size={14} /> Insert
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => hand(true)} disabled={!draft.length}>
              <CornerDownLeft size={14} /> Send
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
