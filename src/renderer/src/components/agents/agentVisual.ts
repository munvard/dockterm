import type { AgentKind, AgentPhase, LiveAgent, MascotCharacter } from '@shared/types'

/** The four mascot characters, reused as the swarm creatures. */
const CREATURES: MascotCharacter[] = ['munu', 'nvurd', 'guru', 'adanana']

/** Stable string hash (djb2) → deterministic creature per agent type. */
function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** Pick a mascot character for an agent type — same type always gets the same one. */
export function creatureFor(type: string): MascotCharacter {
  return CREATURES[hash(type) % CREATURES.length]
}

/** Human-readable agent type: 'general-purpose' → 'General Purpose'. */
export function friendlyType(type: string): string {
  const t = type.trim()
  if (!t) return 'Agent'
  return t
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** A compact running/elapsed time: '5s', '1m 35s', '1h 02m'. */
export function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${String(total % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

/** CSS modifier suffix for an agent phase (drives status color). */
export function phaseClass(phase: AgentPhase): string {
  return phase
}

/** Short badge text for the kind of agent. */
export function kindLabel(kind: AgentKind): string {
  return kind === 'background' ? 'Background' : kind === 'teammate' ? 'Teammate' : 'Sub-agent'
}

/** The name to show: a team member's own name, else the friendly agent type. */
export function agentTitle(a: Pick<LiveAgent, 'name' | 'type'>): string {
  return a.name ? a.name : friendlyType(a.type)
}

/** 'session-07339782' becomes 'Team 07339782'; any other team name is shown as is. */
export function teamLabel(team: string | null): string {
  if (!team) return 'Team'
  const m = /^session-(.+)$/.exec(team)
  return m ? `Team ${m[1]}` : team
}

/** Agents that are alive (working, or a team member waiting for work). */
export const isLive = (a: LiveAgent): boolean => a.phase === 'running' || a.phase === 'idle'

/** '3 steps' / '1 step', or '' when nothing is counted yet. */
export function stepsLabel(steps: number): string {
  return steps > 0 ? `${steps} step${steps === 1 ? '' : 's'}` : ''
}
