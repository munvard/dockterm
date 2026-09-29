import { useEffect, useRef, useState } from 'react'
import { ShieldQuestion, CornerDownLeft, TriangleAlert } from 'lucide-react'
import { pickKeys, submitKeys, textKeys, isFreeText, askSig, ESC } from '../terminal/askKeys'
import type { AskInfo } from '@shared/types'

/** Send answer keys through the paced writer main already uses for munu, so the
 * timing Claude's TUI expects is identical no matter which surface answered.
 * `munu:answer` is zod-validated (each key chunk capped at 2000 chars) — a very
 * long free-text answer can fail that check, and since this was previously fired
 * with `void`, the card just sat there with the draft silently gone. Report
 * whether it actually landed so the caller can keep the draft and show an error
 * instead of pretending the answer was sent. */
async function sendKeys(leafId: string, keys: string[]): Promise<boolean> {
  if (!keys.length) return true
  const r = await window.dockterm.invoke('munu:answer', { leafId, keys })
  return r.ok
}

/**
 * Claude's permission prompt, rendered as real buttons. The options come from
 * `parseAsk` (the same parser munu uses), and answering replays munu's exact key
 * sequences into the pty — chat mode never invents its own protocol.
 */
export function AskCard({ ask, leafId }: { ask: AskInfo; leafId: string }): React.ReactElement {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [typing, setTyping] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  // IME composition (typing Japanese/Chinese/Korean) fires its own Enter to
  // confirm a candidate — the input's onKeyDown still sees that Enter, so guard
  // with the native event's isComposing or it submits a half-typed word.
  const composingRef = useRef(false)

  // A fresh prompt (or a new wizard step) resets local toggles + any text field.
  useEffect(() => {
    setTyping(null)
    setDraft('')
    setSendError(null)
    const init = new Set<number>()
    ask.checked.forEach((c, i) => {
      if (c && ask.checkable[i]) init.add(i)
    })
    setSelected(init)
  }, [leafId, askSig(ask)])

  // Fire-and-forget from a click handler, but surface a failure instead of
  // swallowing it — see sendKeys above.
  const fire = (keys: string[]): void => {
    setSendError(null)
    void sendKeys(leafId, keys).then((sent) => {
      if (!sent) setSendError('Could not send that answer — try again')
    })
  }

  const sendText = (): void => {
    if (typing === null) return
    setSendError(null)
    void sendKeys(leafId, textKeys(ask, typing, draft)).then((sent) => {
      if (sent) {
        setTyping(null)
        setDraft('')
      } else {
        // Keep the draft and the field open — clearing it here is exactly how a
        // failed send used to look identical to a successful one.
        setSendError('Could not send that answer — try again')
      }
    })
  }

  const choose = (i: number): void => {
    if (isFreeText(ask.options[i] ?? '')) {
      setDraft('')
      setSendError(null)
      setTyping(i)
      return
    }
    if (ask.multiSelect && ask.checkable[i]) {
      setSelected((s) => {
        const n = new Set(s)
        if (n.has(i)) n.delete(i)
        else n.add(i)
        return n
      })
      return
    }
    fire(pickKeys(ask, i))
  }

  if (typing !== null) {
    return (
      <div className="askcard">
        <div className="askcard__head">
          <ShieldQuestion size={14} /> {ask.options[typing]}
        </div>
        <div className="askcard__type">
          <input
            className="askcard__input"
            autoFocus
            value={draft}
            placeholder="type your answer…"
            aria-label={ask.options[typing] ?? 'Your answer'}
            onChange={(e) => setDraft(e.target.value)}
            onCompositionStart={() => {
              composingRef.current = true
            }}
            onCompositionEnd={() => {
              composingRef.current = false
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) {
                e.preventDefault()
                sendText()
              } else if (e.key === 'Escape') {
                setTyping(null)
                setDraft('')
                setSendError(null)
              }
            }}
          />
          <button type="button" className="btn btn--primary btn--sm" onClick={sendText}>
            <CornerDownLeft size={13} /> Send
          </button>
        </div>
        {sendError && (
          <div className="askcard__error">
            <TriangleAlert size={12} /> {sendError}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="askcard">
      <div className="askcard__head">
        <ShieldQuestion size={14} /> {ask.title ?? 'Claude needs your permission'}
      </div>
      {ask.steps.length > 0 && (
        <div className="askcard__steps">
          {ask.steps.map((s, i) => (
            <span key={i} className={`askcard__step${s.done ? ' is-done' : ''}`}>
              {s.done ? '✓ ' : ''}
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="askcard__opts">
        {ask.options.map((opt, i) => {
          const checkbox = ask.multiSelect && ask.checkable[i]
          const on = selected.has(i)
          const submit = ask.multiSelect && ask.submitIndex === i
          return (
            <button
              key={i}
              type="button"
              className={`askcard__opt${checkbox && on ? ' is-on' : ''}${submit ? ' is-submit' : ''}`}
              onClick={() => (submit ? fire(submitKeys(ask, selected)) : choose(i))}
              {...(checkbox && { role: 'checkbox', 'aria-checked': on })}
            >
              {checkbox && <span className="askcard__box">{on ? '✓' : ''}</span>}
              <span className="askcard__label">
                {opt}
                {ask.descriptions[i] && <span className="askcard__desc">{ask.descriptions[i]}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {sendError && (
        <div className="askcard__error">
          <TriangleAlert size={12} /> {sendError}
        </div>
      )}
      <button type="button" className="askcard__cancel" onClick={() => fire([ESC])}>
        cancel (esc)
      </button>
    </div>
  )
}
