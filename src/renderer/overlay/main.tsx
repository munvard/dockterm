import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Munu } from '@renderer/components/munu/Munu'
import type { MunuAsk, MunuGlobal, MunuState } from '@shared/types'
import { playAsk, playDone } from './sounds'
import './overlay.css'

const DOWN = '\x1b[B'
const UP = '\x1b[A'
const ENTER = '\r'

const setInteractive = (v: boolean): void => {
  void window.dockterm.invoke('munu:setInteractive', { interactive: v })
}
const sendKeys = (leafId: string, keys: string[]): void => {
  if (keys.length) void window.dockterm.invoke('munu:answer', { leafId, keys })
}
const focus = (): void => {
  void window.dockterm.invoke('munu:focus', undefined)
}

function Overlay() {
  const [g, setG] = useState<MunuGlobal>({ state: 'idle', asks: [] })
  const [sounds, setSounds] = useState(true)
  const [platform, setPlatform] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const prev = useRef<MunuState>('idle')
  const islandRef = useRef<HTMLDivElement | null>(null)
  const lastSize = useRef({ w: 0, h: 0 })
  // Our prediction of where Claude's menu cursor sits (row index), so multi-select
  // toggles can navigate from the right place and reflect live in the terminal.
  const cursor = useRef(0)

  useEffect(() => window.dockterm.on('munu:state', setG), [])
  useEffect(() => window.dockterm.on('munu:reveal', setRevealed), [])

  useEffect(() => {
    void window.dockterm.invoke('settings:get', undefined).then((r) => {
      if (r.ok) setSounds(r.value.munu.sounds)
    })
    void window.dockterm.invoke('app:getInfo', undefined).then((r) => {
      if (r.ok) setPlatform(r.value.platform)
    })
    return window.dockterm.on('settings:changed', (s) => setSounds(s.munu.sounds))
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

  // Reset the multi-select toggles + cursor whenever a fresh prompt is surfaced
  // (toggling boxes doesn't change the row count, so this only fires on a real
  // new question — not on every re-parse).
  useEffect(() => {
    cursor.current = 0
    if (!primary) {
      setSelected(new Set())
      return
    }
    const init = new Set<number>()
    primary.checked.forEach((c, i) => {
      if (c && primary.checkable[i]) init.add(i)
    })
    setSelected(init)
    // Keyed on the question itself too, so advancing to the next wizard step
    // (same option count, new question) still resets the cursor + toggles.
  }, [primary?.leafId, primary?.title, options.length])

  // Measure the rendered content and ask main to size the floating window to fit
  // it exactly — small when it fits small, taller when there are many options.
  useEffect(() => {
    const el = islandRef.current
    if (!el) return
    const pad = platform === 'darwin' ? 34 : 6
    const measure = (): void => {
      const w = Math.ceil(el.offsetWidth) + 44
      const h = Math.ceil(el.offsetHeight) + pad + 44
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
  }, [platform, showCard])

  // Arrow keys to move Claude's menu cursor from its current row to `to`.
  const arrowsTo = (to: number): string[] => {
    const from = cursor.current
    cursor.current = to
    const k = to >= from ? DOWN : UP
    return Array.from({ length: Math.abs(to - from) }, () => k)
  }

  // Only the parsed, un-numbered "Submit" row is the submit action — never guess
  // from a label (a "Submit answers" option in a plain Submit/Cancel menu is a
  // normal single-select choice, not our multi-select submit).
  const isSubmitRow = (i: number): boolean =>
    primary?.multiSelect === true && primary?.submitIndex === i

  // Single-select: Claude selects directly on the number key (immune to byte
  // coalescing / arrow-format quirks). Big menus (>9) fall back to paced arrows.
  const pickSingle = (i: number): void => {
    if (!primary) return
    if (i < 9) sendKeys(primary.leafId, [String(i + 1)])
    else sendKeys(primary.leafId, [...arrowsTo(i), ENTER])
  }

  // Multi-select: navigate to the row and press Enter to toggle it — live, so the
  // checkbox flips in the terminal immediately. Optimistically reflect it here too.
  const toggleLive = (i: number): void => {
    if (!primary) return
    sendKeys(primary.leafId, [...arrowsTo(i), ENTER])
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  }

  // A non-checkbox action row in a multi-select (e.g. "Type something"): pick it
  // and bring the terminal forward so the user can continue there.
  const pickActionRow = (i: number): void => {
    if (!primary) return
    sendKeys(primary.leafId, [...arrowsTo(i), ENTER])
    focus()
  }

  const submitMulti = (): void => {
    if (!primary || primary.submitIndex == null) return
    sendKeys(primary.leafId, [...arrowsTo(primary.submitIndex), ENTER])
  }

  // Esc cancels — every prompt footer offers it, so this is always safe.
  const cancel = (): void => {
    if (primary) sendKeys(primary.leafId, ['\x1b'])
  }

  return (
    <div className={`ov ov--${platform}${revealed ? ' ov--revealed' : ' ov--hidden'}`}>
      <div
        ref={islandRef}
        className={`island island--${g.state}${showCard ? ' island--card' : ''}`}
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => setInteractive(false)}
        onClick={() => {
          if (!showCard) focus()
        }}
        title="munu"
      >
        <Munu state={g.state} size={showCard ? 34 : 48} />
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
            <div className="island__opts">
              {options.map((opt, i) => {
                const desc = primary.descriptions[i]
                // Multi-select checkbox row: toggle live.
                if (primary.multiSelect && primary.checkable[i]) {
                  const on = selected.has(i)
                  return (
                    <button
                      key={i}
                      className={`ob ob--check${on ? ' ob--on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleLive(i)
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
                // Submit row → finalize; other rows → pick directly (single) or
                // pick that action (multi).
                const submit = isSubmitRow(i)
                return (
                  <button
                    key={i}
                    className={`ob${!primary.multiSelect && i === 0 ? ' ob--first' : ''}${submit ? ' ob--submit' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (submit) submitMulti()
                      else if (primary.multiSelect) pickActionRow(i)
                      else pickSingle(i)
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
                  focus()
                }}
              >
                open terminal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const container = document.getElementById('overlay-root')
if (container) createRoot(container).render(<Overlay />)
