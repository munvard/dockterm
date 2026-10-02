// src/renderer/overlay/MunuPopup.tsx
import { useEffect, useState } from 'react'
import type { LiveAgent, MascotCharacter } from '@shared/types'
import { Munu } from '@renderer/components/munu/Munu'
import { CHARACTERS } from '@renderer/components/munu/mascots'
import { agentTitle, fmtElapsed, isLive, kindLabel } from '@renderer/components/agents/agentVisual'

const AGENT_ROWS = 5

function AgentRows({ agents }: { agents: LiveAgent[] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const live = agents.filter(isLive)
  if (live.length === 0) return null
  const shown = live.slice(0, AGENT_ROWS)
  return (
    <div className="mpop__agents">
      <div className="mpop__label mpop__label--block">
        Agents <span className="mpop__count">{agents.filter((a) => a.phase === 'running').length} running</span>
      </div>
      {shown.map((a) => (
        <div className={`mpop__agent mpop__agent--${a.phase}`} key={a.id}>
          <div className="mpop__agent-top">
            <span className={`kindbadge kindbadge--${a.kind}`}>{kindLabel(a.kind)}</span>
            <span className="mpop__agent-name">{agentTitle(a)}</span>
            <span className="mpop__agent-time">
              {a.phase === 'idle' ? 'idle' : fmtElapsed(now - a.startedAt)}
            </span>
          </div>
          <div className="mpop__agent-line">{a.action ?? a.description}</div>
        </div>
      ))}
      {live.length > shown.length && <div className="mpop__agent-more">+{live.length - shown.length} more</div>}
    </div>
  )
}

const SIZE_MIN = 36
const SIZE_MAX = 120
const SIZE_STEP = 8

export function MunuPopup({
  size,
  character,
  pinned,
  agents,
  onSize,
  onCharacter,
  onPin,
  onOpenApp
}: {
  size: number
  character: MascotCharacter
  pinned: boolean
  agents: LiveAgent[]
  onSize: (next: number) => void
  onCharacter: (c: MascotCharacter) => void
  onPin: (next: boolean) => void
  onOpenApp: () => void
}) {
  const clamp = (n: number): number => Math.min(SIZE_MAX, Math.max(SIZE_MIN, n))
  return (
    <div className="mpop" onClick={(e) => e.stopPropagation()}>
      <div className="mpop__row">
        <span className="mpop__label">Size</span>
        <div className="mpop__stepper">
          <button
            className="mpop__btn"
            disabled={size <= SIZE_MIN}
            onClick={() => onSize(clamp(size - SIZE_STEP))}
            title="Smaller"
          >
            −
          </button>
          <span className="mpop__val">{size}</span>
          <button
            className="mpop__btn"
            disabled={size >= SIZE_MAX}
            onClick={() => onSize(clamp(size + SIZE_STEP))}
            title="Bigger"
          >
            +
          </button>
        </div>
      </div>

      <div className="mpop__label mpop__label--block">Character</div>
      <div className="mpop__chars">
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            className={`mpop__char${character === c.id ? ' is-active' : ''}`}
            onClick={() => onCharacter(c.id)}
            title={c.blurb}
            aria-pressed={character === c.id}
          >
            <Munu state="idle" character={c.id} size={34} />
          </button>
        ))}
      </div>

      <AgentRows agents={agents} />

      <div className="mpop__row">
        <span className="mpop__label">
          Pin to screen
          <span className="mpop__hint">always visible · drag anywhere</span>
        </span>
        <button
          className={`mpop__toggle${pinned ? ' is-on' : ''}`}
          role="switch"
          aria-checked={pinned}
          onClick={() => onPin(!pinned)}
        >
          <span className="mpop__knob" />
        </button>
      </div>

      <button className="mpop__open" onClick={onOpenApp}>
        Open DockTerm
      </button>
    </div>
  )
}
