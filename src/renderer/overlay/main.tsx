import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Munu } from '@renderer/components/munu/Munu'
import type { MunuAsk, MunuGlobal, MunuState } from '@shared/types'
import { playAsk, playDone } from './sounds'
import './overlay.css'

const DOWN = '\x1b[B'
const UP = '\x1b[A'
const ENTER = '\r'
const ESC = '\x1b'

const setInteractive = (v: boolean): void => {
  void window.dockterm.invoke('munu:setInteractive', { interactive: v })
}
const setFocusable = (v: boolean): void => {
  void window.dockterm.invoke('munu:setFocusable', { focusable: v })
}
const sendKeys = (leafId: string, keys: string[]): void => {
  if (keys.length) void window.dockterm.invoke('munu:answer', { leafId, keys })
}
const focusTerminal = (): void => {
  void window.dockterm.invoke('munu:focus', undefined)
}

/** Arrow-key chunks to move Claude's menu cursor from row `from` to row `to`. */
const arrows = (from: number, to: number): string[] => {
  const k = to >= from ? DOWN : UP
  return Array.from({ length: Math.abs(to - from) }, () => k)
}

/** Rows that open a free-text field ("Type something", "Other", "something else"). */
const isFreeText = (label: string): boolean =>
  /^type\b/i.test(label) || /^other$/i.test(label) || /something else$/i.test(label)

function Overlay() {
  const [g, setG] = useState<MunuGlobal>({ state: 'idle', asks: [] })
  const [sounds, setSounds] = useState(true)
  const [munuSize, setMunuSize] = useState(56)
  const [platform, setPlatform] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // Row index we're typing a free-text answer for, or null.
  const [typing, setTyping] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const prev = useRef<MunuState>('idle')
  const islandRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const lastSize = useRef({ w: 0, h: 0 })

  useEffect(() => window.dockterm.on('munu:state', setG), [])
  useEffect(() => window.dockterm.on('munu:reveal', setRevealed), [])

  useEffect(() => {
    void window.dockterm.invoke('settings:get', undefined).then((r) => {
      if (r.ok) {
        setSounds(r.value.munu.sounds)
        setMunuSize(r.value.munu.size)
      }
    })
    void window.dockterm.invoke('app:getInfo', undefined).then((r) => {
      if (r.ok) setPlatform(r.value.platform)
    })
    return window.dockterm.on('settings:changed', (s) => {
      setSounds(s.munu.sounds)
      setMunuSize(s.munu.size)
    })
  }, [])

  useEffect(() => {
    if (g.state !== prev.current) {
      if (sounds && g.state === 'asking') playAsk()
      if (sounds && g.state === 'done') playDone()
      prev.current = g.state
    }
  }, [g.state, sounds])

  const asking = g.state === 'asking'
  // Surface the first ask the user CAN'T currently see; if every asking pane is
  // on-screen, there's nothing to pop (states/sounds still fire — just no card).
  const primary: MunuAsk | undefined = g.asks.find((a) => !a.visible) ?? g.asks[0]
  const options = primary?.options ?? []
  const showCard = asking && !!primary && !primary.visible && options.length > 0

  // Reset toggles + text mode whenever a fresh prompt (or wizard step) is shown.
  useEffect(() => {
    setTyping(null)
    setDraft('')
    if (!primary) {
      setSelected(new Set())
      return
    }
    const init = new Set<number>()
    primary.checked.forEach((c, i) => {
      if (c && primary.checkable[i]) init.add(i)
    })
    setSelected(init)
  }, [primary?.leafId, primary?.title, options.length])

  // Make the window focusable only while typing (so the field gets keystrokes),
  // and autofocus the input.
  useEffect(() => {
    setFocusable(typing !== null)
    if (typing === null) return
    const t = setTimeout(() => inputRef.current?.focus(), 40)
    return () => clearTimeout(t)
  }, [typing])

  // Measure content and size the floating window to fit it fully (clamped to the
  // screen by main). Generous margins so the shadow/last row never clip.
  useEffect(() => {
    const el = islandRef.current
    if (!el) return
    const pad = platform === 'darwin' ? 34 : 8
    const measure = (): void => {
      const w = Math.ceil(el.offsetWidth) + 48
      const h = Math.ceil(el.offsetHeight) + pad + 52
      if (Math.abs(w - lastSize.current.w) < 2 && Math.abs(h - lastSize.current.h) < 2) return
      lastSize.current = { w, h }
      void window.dockterm.invoke('munu:resize', { width: w, height: h })
    }
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    ro.observe(el)
    measure()
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [platform, showCard, typing])

  // Cap the option list to the real screen height so a long menu scrolls inside
  // the card instead of running off-screen.
  const optsMax = Math.max(180, (window.screen?.availHeight ?? 800) - 260)

  const toggleLocal = (i: number): void =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  // Single-select / action rows. Free-text rows open the text field instead.
  const pick = (i: number): void => {
    if (!primary) return
    if (isFreeText(options[i] ?? '')) {
      setDraft('')
      setTyping(i)
      return
    }
    if (primary.multiSelect) {
      // A non-checkbox action row (e.g. "Chat about this"): one clean sequence.
      sendKeys(primary.leafId, [...arrows(primary.cursorRow, i), ENTER])
      focusTerminal()
    } else if (i < 9) {
      sendKeys(primary.leafId, [String(i + 1)]) // Claude selects on the number key
    } else {
      sendKeys(primary.leafId, [...arrows(primary.cursorRow, i), ENTER])
    }
  }

  // Multi-select: clicks only update the card (instant, race-free). On Submit we
  // send ONE deterministic sequence from Claude's real cursor row — toggling each
  // changed box top-to-bottom, then Enter on Submit.
  const submitMulti = (): void => {
    if (!primary || primary.submitIndex == null) return
    const toggles: number[] = []
    options.forEach((_, i) => {
      if (primary.checkable[i] && selected.has(i) !== !!primary.checked[i]) toggles.push(i)
    })
    let cur = primary.cursorRow
    const seq: string[] = []
    for (const t of toggles) {
      seq.push(...arrows(cur, t), ENTER)
      cur = t
    }
    seq.push(...arrows(cur, primary.submitIndex), ENTER)
    sendKeys(primary.leafId, seq)
  }

  // Send the typed free-text answer: select that row (entering Claude's text
  // field), type the text, Enter.
  const sendText = (): void => {
    if (!primary || typing == null) return
    const i = typing
    const select =
      !primary.multiSelect && i < 9 ? [String(i + 1)] : [...arrows(primary.cursorRow, i), ENTER]
    sendKeys(primary.leafId, [...select, draft, ENTER])
    setTyping(null)
    setDraft('')
  }

  const cancel = (): void => {
    if (primary) sendKeys(primary.leafId, [ESC])
  }

  return (
    <div className={`ov ov--${platform}${revealed ? ' ov--revealed' : ' ov--hidden'}`}>
      <div
        ref={islandRef}
        className={`island island--${g.state}${showCard ? ' island--card' : ''}`}
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => setInteractive(false)}
        onClick={() => {
          if (!showCard) focusTerminal()
        }}
        title="munu"
      >
        <Munu state={g.state} size={showCard ? Math.round(munuSize * 0.75) : munuSize} />
        {showCard && primary && (
          <div className={`island__card${primary.multiSelect ? ' island__card--multi' : ''}`}>
            {primary.steps.length > 0 && (
              <div className="island__steps">
                {primary.steps.map((s, i) => (
                  <span key={i} className={`step${s.done ? ' step--done' : ''}`}>
                    {s.done ? '✓ ' : ''}
                    {s.label}
                  </span>
                ))}
              </div>
            )}
            {primary.title && <div className="island__title">{primary.title}</div>}

            {typing !== null ? (
              <div className="island__type">
                <input
                  ref={inputRef}
                  className="island__input"
                  value={draft}
                  placeholder="type your answer…"
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      sendText()
                    } else if (e.key === 'Escape') {
                      setTyping(null)
                    }
                  }}
                />
                <div className="island__foot">
                  <button
                    className="ob ob--submit"
                    onClick={(e) => {
                      e.stopPropagation()
                      sendText()
                    }}
                  >
                    send
                  </button>
                  <button
                    className="ob ob--ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      setTyping(null)
                    }}
                  >
                    back
                  </button>
                  <button
                    className="ob ob--ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      focusTerminal()
                    }}
                  >
                    open terminal
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="island__opts" style={{ maxHeight: optsMax }}>
                  {options.map((opt, i) => {
                    const desc = primary.descriptions[i]
                    if (primary.multiSelect && primary.checkable[i]) {
                      const on = selected.has(i)
                      return (
                        <button
                          key={i}
                          className={`ob ob--check${on ? ' ob--on' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleLocal(i)
                          }}
                        >
                          <span className="box">{on ? '✓' : ''}</span>
                          <span className="lbl">
                            {opt}
                            {desc && <span className="desc">{desc}</span>}
                          </span>
                        </button>
                      )
                    }
                    const submit = primary.multiSelect && primary.submitIndex === i
                    return (
                      <button
                        key={i}
                        className={`ob${!primary.multiSelect && i === 0 ? ' ob--first' : ''}${submit ? ' ob--submit' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (submit) submitMulti()
                          else pick(i)
                        }}
                      >
                        {!primary.multiSelect && !submit && <span className="num">{i + 1}</span>}
                        <span className="lbl">
                          {opt}
                          {desc && <span className="desc">{desc}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="island__foot">
                  <button
                    className="ob ob--ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      cancel()
                    }}
                  >
                    cancel (esc)
                  </button>
                  <button
                    className="ob ob--ghost"
                    onClick={(e) => {
                      e.stopPropagation()
                      focusTerminal()
                    }}
                  >
                    open terminal
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const container = document.getElementById('overlay-root')
if (container) createRoot(container).render(<Overlay />)
