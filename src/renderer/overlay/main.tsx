import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Munu } from '@renderer/components/munu/Munu'
import type { MunuGlobal, MunuState } from '@shared/types'
import { playAsk, playDone } from './sounds'
import './overlay.css'

const setInteractive = (v: boolean): void => {
  void window.dockterm.invoke('munu:setInteractive', { interactive: v })
}
const answer = (key: 'enter' | 'esc'): void => {
  void window.dockterm.invoke('munu:answer', { key })
}
const focus = (): void => {
  void window.dockterm.invoke('munu:focus', undefined)
}

function Overlay() {
  const [g, setG] = useState<MunuGlobal>({ state: 'idle', asks: [] })
  const [sounds, setSounds] = useState(true)
  const [platform, setPlatform] = useState('')
  const [revealed, setRevealed] = useState(false)
  const prev = useRef<MunuState>('idle')

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

  // Cue on entering asking / done (the "whole work finished" chime).
  useEffect(() => {
    if (g.state !== prev.current) {
      if (sounds && g.state === 'asking') playAsk()
      if (sounds && g.state === 'done') playDone()
      prev.current = g.state
    }
  }, [g.state, sounds])

  const asking = g.state === 'asking'
  const ask = g.asks[0]
  const showCard = asking && !!ask?.binary // only true yes/no gets one-click buttons

  return (
    <div className={`ov ov--${platform}${revealed ? ' ov--revealed' : ' ov--hidden'}`}>
      <div
        className={`island island--${g.state}${showCard ? ' island--card' : ''}`}
        onMouseEnter={() => setInteractive(true)}
        onMouseLeave={() => setInteractive(false)}
        onClick={() => {
          if (!showCard) focus()
        }}
        title="munu"
      >
        <Munu state={g.state} size={showCard ? 32 : 40} />
        {showCard && (
          <div className="island__card">
            {ask?.title && <div className="island__title">{ask.title}</div>}
            <div className="island__actions">
              <button
                className="ob ob--yes"
                onClick={(e) => {
                  e.stopPropagation()
                  answer('enter')
                }}
              >
                [y] yes
              </button>
              <button
                className="ob ob--no"
                onClick={(e) => {
                  e.stopPropagation()
                  answer('esc')
                }}
              >
                [n] no
              </button>
              <button
                className="ob"
                onClick={(e) => {
                  e.stopPropagation()
                  focus()
                }}
              >
                open
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
