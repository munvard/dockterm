import { describe, it, expect } from 'vitest'
import { homedir } from 'node:os'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAgentTracker } from '../../src/main/services/agentTracker'
import { parseAgentLine, reduceActivity, type AgentEvent } from '../../src/main/services/agentParse'

/**
 * Manual replay against the REAL ~/.claude of this machine (read-only).
 * Skipped in normal runs. Run: AGENT_REPLAY=1 npx vitest run tests/unit/agentReplay.test.ts
 */
describe.skipIf(!process.env.AGENT_REPLAY)('replay on real ~/.claude data', () => {
  it('prints the live agents with kind, phase, action and steps', async () => {
    const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    const tr = createAgentTracker({ projectsDir: join(base, 'projects'), sessionsDir: join(base, 'sessions') })
    const t0 = Date.now()
    await tr.scan()
    const first = Date.now() - t0
    const t1 = Date.now()
    await tr.scan()
    const second = Date.now() - t1
    const snap = tr.snapshot({ retainMs: 3_600_000 })
    console.log(`sessions followed: ${tr.sessionCount()}  first scan ${first}ms  second scan ${second}ms`)
    for (const a of snap.agents) {
      const age = Math.round((Date.now() - a.startedAt) / 1000)
      console.log(
        [a.kind.padEnd(10), a.phase.padEnd(7), (a.name ?? a.type).slice(0, 24).padEnd(24), `steps=${a.steps}`.padEnd(10), `age=${age}s`.padEnd(10), a.teamName ?? '-', '|', a.action ?? '-', '|', (a.resultPreview ?? '').slice(0, 50)].join(' ')
      )
    }
    console.log(`active=${snap.activeCount} total=${snap.agents.length}`)
    expect(Array.isArray(snap.agents)).toBe(true)
  })
})

/** AGENT_REPLAY_FILE=<parent transcript>: parse a whole finished session and show the end state of every agent. */
describe.skipIf(!process.env.AGENT_REPLAY_FILE)('replay one whole transcript', () => {
  it('reduces every agent in the file', () => {
    const lines = readFileSync(process.env.AGENT_REPLAY_FILE as string, 'utf8').split('\n')
    const pending = new Set<string>()
    const events: AgentEvent[] = []
    for (const l of lines) {
      for (const e of parseAgentLine(l, pending)) {
        events.push(e)
        if (e.kind === 'spawn') pending.add(e.id)
        else if (e.kind === 'launch' || e.kind === 'result') pending.delete(e.id)
      }
    }
    const last = Math.max(...events.map((e) => e.ts))
    const snap = reduceActivity(events, last + 1000, { retainMs: 1e12, staleMs: 1e12, idleKeepMs: 1e12 })
    const tally: Record<string, number> = {}
    for (const a of snap.agents) tally[`${a.kind}/${a.phase}`] = (tally[`${a.kind}/${a.phase}`] ?? 0) + 1
    console.log(`events=${events.length} agents=${snap.agents.length}`, JSON.stringify(tally))
    for (const a of snap.agents.slice(0, 12)) {
      console.log(a.kind.padEnd(10), a.phase.padEnd(7), (a.name ?? a.type).slice(0, 22).padEnd(22), a.teamName ?? '-', a.agentId ?? '-', a.durationMs ?? '-', '|', (a.resultPreview ?? '').slice(0, 40))
    }
    expect(snap.agents.length).toBeGreaterThan(0)
  })
})
