import type { CSSProperties } from 'react'
import { Munu } from '@renderer/components/munu/Munu'
import { creatureFor, teamLabel } from '@renderer/components/agents/agentVisual'
import type { LiveAgent } from '@shared/types'

const MAX = 6

/**
 * A little swarm of creatures that gathers under the floating munu while Claude
 * Code agents are running: one mascot per running agent of any kind (sub-agent,
 * background agent or team member). Team members sit together after a small label.
 * Tasteful: capped, staggered entrance, gentle bob, transform/opacity only.
 */
export function Swarm({ agents, size }: { agents: LiveAgent[]; size: number }) {
  const running = agents.filter((a) => a.phase === 'running')
  if (running.length === 0) return null
  const solo = running.filter((a) => a.kind !== 'teammate')
  const mates = running.filter((a) => a.kind === 'teammate')
  const ordered = [...solo, ...mates]
  const shown = ordered.slice(0, MAX)
  const extra = ordered.length - shown.length
  const cs = Math.max(16, Math.round(size * 0.4))
  const firstMate = shown.findIndex((a) => a.kind === 'teammate')
  const teams = new Set(mates.map((a) => a.teamName ?? ''))
  const label = teams.size === 1 ? teamLabel([...teams][0] || null) : 'Teams'

  return (
    <div className="swarm" aria-hidden>
      {shown.map((a, i) => (
        <span key={a.id} className="swarm__item">
          {i === firstMate && <span className="swarm__team" title={label}>team</span>}
          <span className="swarm__bug" style={{ '--i': i } as CSSProperties}>
            <Munu state="working" character={creatureFor(a.name ?? a.type)} size={cs} />
          </span>
        </span>
      ))}
      {extra > 0 && <span className="swarm__more">+{extra}</span>}
    </div>
  )
}
