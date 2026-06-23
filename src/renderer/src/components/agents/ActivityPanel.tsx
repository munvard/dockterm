import { useEffect, useState } from 'react'
import { Workflow, RefreshCw, Check, X, FolderGit2 } from 'lucide-react'
import { useAgentStore } from '../../state/useAgentStore'
import { useAppStore } from '../../state/useAppStore'
import { Munu } from '../munu/Munu'
import type { LiveAgent, MunuState } from '@shared/types'
import { creatureFor, friendlyType, fmtElapsed } from './agentVisual'

/** Re-render every second while something is running, so elapsed timers tick. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

const artState = (a: LiveAgent): MunuState =>
  a.phase === 'running' ? 'working' : a.phase === 'done' ? 'done' : 'asking'

function AgentCard({ agent, now }: { agent: LiveAgent; now: number }) {
  const elapsed =
    agent.phase === 'running'
      ? now - agent.startedAt
      : (agent.durationMs ?? Math.max(0, (agent.endedAt ?? now) - agent.startedAt))
  return (
    <div className={`agent-card agent-card--${agent.phase}`}>
      <div className="agent-card__rail" aria-hidden />
      <div className={`agent-card__avatar agent-card__avatar--${agent.phase}`}>
        <Munu state={artState(agent)} character={creatureFor(agent.type)} size={30} />
      </div>
      <div className="agent-card__body">
        <div className="agent-card__top">
          <span className="agent-card__type">{friendlyType(agent.type)}</span>
          <span className={`agent-card__status agent-card__status--${agent.phase}`}>
            {agent.phase === 'running' && (
              <>
                <span className="agent-card__dot" /> running
              </>
            )}
            {agent.phase === 'done' && (
              <>
                <Check size={11} /> done
              </>
            )}
            {agent.phase === 'failed' && (
              <>
                <X size={11} /> failed
              </>
            )}
          </span>
        </div>
        {agent.description && <div className="agent-card__desc">{agent.description}</div>}
        <div className="agent-card__meta">
          <span className="agent-card__time">{fmtElapsed(elapsed)}</span>
        </div>
        {agent.phase === 'running' ? (
          <div className="agent-card__working" aria-hidden>
            <span className="agent-card__shimmer" />
          </div>
        ) : agent.resultPreview ? (
          <div className="agent-card__result">{agent.resultPreview}</div>
        ) : agent.phase === 'failed' ? (
          <div className="agent-card__result agent-card__result--muted">Finished with an error.</div>
        ) : null}
      </div>
    </div>
  )
}

export function ActivityPanel() {
  const activity = useAgentStore((s) => s.activity)
  const load = useAgentStore((s) => s.load)
  const enabled = useAppStore((s) => s.settings?.agentActivity?.enabled) ?? true
  const now = useNow((activity?.activeCount ?? 0) > 0)

  useEffect(() => {
    if (enabled) void load()
  }, [load, enabled])

  const agents = activity?.agents ?? []
  const running = agents.filter((a) => a.phase === 'running')
  const finished = agents.filter((a) => a.phase !== 'running')

  // Group running agents by project (most-active first), derived directly from the
  // agents so no running agent can ever be missing from a group.
  const groupMap = new Map<string, { label: string; agents: LiveAgent[] }>()
  for (const a of running) {
    const g = groupMap.get(a.project) ?? { label: a.projectLabel, agents: [] }
    g.agents.push(a)
    groupMap.set(a.project, g)
  }
  const groups = [...groupMap.entries()]
    .map(([project, g]) => ({ project, label: g.label, agents: g.agents }))
    .sort((x, y) => y.agents.length - x.agents.length)

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Activity</span>
        <div className="panel__actions">
          {running.length > 0 && (
            <span className="agent-livecount">
              <span className="agent-livecount__dot" /> {running.length} running
            </span>
          )}
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void load()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        {!enabled ? (
          <div className="mcp-empty">
            <Workflow size={15} /> Agent activity is turned off. Turn it back on in{' '}
            <b>Settings → Agent activity</b>.
          </div>
        ) : agents.length === 0 ? (
          <div className="agent-empty">
            <div className="agent-empty__art">
              <Munu state="idle" character="munu" size={44} />
            </div>
            <div className="agent-empty__title">No agents running</div>
            <div className="agent-empty__sub">
              When Claude Code spawns sub-agents, they show up here live — what each is doing, how
              long it&apos;s taken, and what it found.
            </div>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <div className="agent-group" key={g.project}>
                <div className="agent-group__head">
                  <FolderGit2 size={12} />
                  <span className="agent-group__name">{g.label}</span>
                  <span className="agent-group__count">{g.agents.length}</span>
                </div>
                <div className="agent-list">
                  {g.agents.map((a) => (
                    <AgentCard key={a.id} agent={a} now={now} />
                  ))}
                </div>
              </div>
            ))}

            {finished.length > 0 && (
              <div className="agent-group agent-group--done">
                <div className="agent-group__head">
                  <span className="agent-group__name">Just finished</span>
                  <span className="agent-group__count">{finished.length}</span>
                </div>
                <div className="agent-list">
                  {finished.map((a) => (
                    <AgentCard key={a.id} agent={a} now={now} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
