import { useEffect } from 'react'
import { useAgentStore } from '../../state/useAgentStore'
import { useAppStore } from '../../state/useAppStore'
import { Munu } from '../munu/Munu'
import { creatureFor } from './agentVisual'

/**
 * A live, glanceable count of Claude Code sub-agents running right now. Sits in the
 * top bar (like the usage pill); hidden when nothing is running or the user turned
 * it off. Clicking opens the Activity panel. The leading creature is the mascot of
 * the newest running agent, so the bar itself feels alive while agents work.
 */
export function AgentPill() {
  const activity = useAgentStore((s) => s.activity)
  const load = useAgentStore((s) => s.load)
  const enabled = useAppStore((s) => s.settings?.agentActivity?.enabled) ?? true
  const showPill = useAppStore((s) => s.settings?.agentActivity?.pill) ?? true
  const openPanel = useAppStore((s) => s.openPanel)
  const toggle = useAppStore((s) => s.togglePanel)

  useEffect(() => {
    if (enabled) void load()
  }, [load, enabled])

  if (!enabled || !showPill) return null
  const count = activity?.activeCount ?? 0
  if (count === 0) return null

  const lead = activity?.agents.find((a) => a.phase === 'running')
  const tip = `${count} agent${count === 1 ? '' : 's'} running — click for live activity`

  return (
    <button
      className={`agent-pill${openPanel === 'activity' ? ' agent-pill--active' : ''}`}
      data-tip={tip}
      aria-label={tip}
      onClick={() => toggle('activity')}
    >
      <span className="agent-pill__creature">
        <Munu state="working" character={creatureFor(lead?.type ?? 'agent')} size={16} />
      </span>
      <span className="agent-pill__count">{count}</span>
      <span className="agent-pill__pulse" aria-hidden />
    </button>
  )
}
