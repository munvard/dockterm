import { useEffect, useState } from 'react'
import { ShieldQuestion, CornerDownLeft } from 'lucide-react'
import { pickKeys, submitKeys, textKeys, isFreeText, ESC } from '../terminal/askKeys'
import type { AskInfo } from '@shared/types'

/** Send answer keys through the paced writer main already uses for munu, so the
 * timing Claude's TUI expects is identical no matter which surface answered. */
function sendKeys(leafId: string, keys: string[]): void {
  if (keys.length) void window.dockterm.invoke('munu:answer', { leafId, keys })
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

  // A fresh prompt (or a new wizard step) resets local toggles + any text field.
  useEffect(() => {
    setTyping(null)
    setDraft('')
    const init = new Set<number>()
    ask.checked.forEach((c, i) => {
      if (c && ask.checkable[i]) init.add(i)
    })
    setSelected(init)
  }, [ask.title, ask.options.length])

  const choose = (i: number): void => {
    if (isFreeText(ask.options[i] ?? '')) {
      setDraft('')
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
    sendKeys(leafId, pickKeys(ask, i))
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sendKeys(leafId, textKeys(ask, typing, draft))
                setTyping(null)
                setDraft('')
              } else if (e.key === 'Escape') {
                setTyping(null)
              }
            }}
          />
          <button className="btn btn--primary btn--sm" onClick={() => {
            sendKeys(leafId, textKeys(ask, typing, draft))
            setTyping(null)
            setDraft('')
          }}>
            <CornerDownLeft size={13} /> Send
          </button>
        </div>
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
              className={`askcard__opt${checkbox && on ? ' is-on' : ''}${submit ? ' is-submit' : ''}`}
              onClick={() => (submit ? sendKeys(leafId, submitKeys(ask, selected)) : choose(i))}
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
      <button className="askcard__cancel" onClick={() => sendKeys(leafId, [ESC])}>
        cancel (esc)
      </button>
    </div>
  )
}
