import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Munu } from '@renderer/components/munu/Munu'
import type { MascotCharacter, MunuAsk, MunuGlobal, MunuState, Settings } from '@shared/types'
import { playAsk, playDone } from './sounds'
import { MunuPopup } from './MunuPopup'
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
  const [character, setCharacter] = useState<MascotCharacter>('munu')
  const [pinned, setPinned] = useState(false)
  const [popupOpen, setPopupOpen] = useState(false)
  const [showHint, setShowHint] = useState(false)
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
  const munuRef = useRef<Settings['munu'] | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; wx: number; wy: number } | null>(null)
  const movedRef = useRef(false)
  const prevPinned = useRef(false)

  useEffect(() => window.dockterm.on('munu:state', setG), [])
  useEffect(() => window.dockterm.on('munu:reveal', setRevealed), [])

  useEffect(() => {
    void window.dockterm.invoke('settings:get', undefined).then((r) => {
      if (r.ok) {
        munuRef.current = r.value.munu
        setSounds(r.value.munu.sounds)
        setMunuSize(r.value.munu.size)
        setCharacter(r.value.munu.character)
        setPinned(r.value.munu.pinned)
        prevPinned.current = r.value.munu.pinned
      }
    })
    void window.dockterm.invoke('app:getInfo', undefined).then((r) => {
      if (r.ok) setPlatform(r.value.platform)
    })
    return window.dockterm.on('settings:changed', (s) => {
      munuRef.current = s.munu
      setSounds(s.munu.sounds)
      setMunuSize(s.munu.size)
      setCharacter(s.munu.character)
      setPinned(s.munu.pinned)
      if (s.munu.pinned && !prevPinned.current) {
        setShowHint(true)
        setTimeout(() => setShowHint(false), 5000)
      }
      prevPinned.current = s.munu.pinned
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
      // Expanded = popup / ask-card / text field open: grow around munu's centre
      // (pinned munu stays put). At rest, return to the saved top-left.
      const expanded = popupOpen || showCard || typing !== null
      void window.dockterm.invoke('munu:resize', { width: w, height: h, expanded })
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
    // popupOpen is included so the window resizes immediately when the quick
    // settings popup opens/closes, instead of lagging a beat behind its content.
  }, [platform, showCard, typing, popupOpen])

  // Cap the option list so the whole card — munu head, title, this list, AND the
  // footer row — fits inside the work-area-clamped window. The reserve leaves
  // room for that chrome + margins so the cancel / open-terminal footer is never
  // pushed off the bottom; a longer menu scrolls inside the list instead.
  const optsMax = Math.max(170, (window.screen?.availHeight ?? 800) - 340)

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

  const writeMunu = (patch: Partial<Settings['munu']>): void => {
    const base = munuRef.current
    if (!base) return
    void window.dockterm.invoke('settings:set', { munu: { ...base, ...patch } } as never)
  }

  const showApp = (): void => {
    void window.dockterm.invoke('munu:showApp', undefined)
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (showCard) return
    movedRef.current = false
    if (!pinned) return // only pinned munu drags
    void window.dockterm.invoke('munu:getBounds', undefined).then((r) => {
      if (r.ok) dragRef.current = { sx: e.screenX, sy: e.screenY, wx: r.value.x, wy: r.value.y }
    })
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const dx = e.screenX - d.sx
    const dy = e.screenY - d.sy
    if (!movedRef.current && Math.hypot(dx, dy) < 4) return
    movedRef.current = true
    void window.dockterm.invoke('munu:move', { x: d.wx + dx, y: d.wy + dy })
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = dragRef.current
    dragRef.current = null
    if (showCard) return
    if (d && movedRef.current) {
      const dx = e.screenX - d.sx
      const dy = e.screenY - d.sy
      writeMunu({ position: { x: d.wx + dx, y: d.wy + dy } })
      return // a drag, not a click
    }
    // A real click just toggles munu's popup — it must NOT surface/open the
    // terminal (the popup itself has an "open terminal" button for that).
    setPopupOpen((o) => !o)
  }

  // When pinned, munu is always shown — decided locally so it never flickers
  // waiting on the main-process reveal round-trip after a pin/unpin. While the
  // settings popup is open, keep munu revealed even if the cursor leaves the top
  // reveal zone (so reaching down to the popup doesn't tuck it away). The Claude
  // ask-card manages its own reveal, so the popup clause only applies with no card.
  const shown = pinned || revealed || (popupOpen && !showCard)

  return (
    <div className={`ov ov--${platform}${shown ? ' ov--revealed' : ' ov--hidden'}`}>
      <div
        ref={islandRef}
        className={`island island--${g.state}${showCard ? ' island--card' : ''}${pinned ? ' island--pinned' : ''}`}
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => {
          // Leaving the whole munu+popup area dismisses the popup, so an unpinned
          // munu resumes its normal auto-tuck. Moving between munu and the popup
          // stays inside .island, so this doesn't fire mid-interaction.
          setInteractive(false)
          setPopupOpen(false)
        }}
      >
        <div
          className="island__munu"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title={pinned ? 'munu — drag to move · click for settings' : 'munu'}
        >
          {pinned && showHint && (
            <>
              <span className="movehint movehint--l">‹</span>
              <span className="movehint movehint--r">›</span>
              <span className="movehint__tip">drag me anywhere</span>
            </>
          )}
          <Munu
            state={g.state}
            character={character}
            size={showCard ? Math.round(munuSize * 0.75) : munuSize}
          />
        </div>

        {popupOpen && !showCard && (
          <MunuPopup
            size={munuSize}
            character={character}
            pinned={pinned}
            onSize={(n) => writeMunu({ size: n })}
            onCharacter={(c) => writeMunu({ character: c })}
            onPin={(p) => writeMunu({ pinned: p })}
            onOpenApp={() => showApp()}
          />
        )}

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
