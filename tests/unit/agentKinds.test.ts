import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAgentLine,
  reduceActivity,
  feedSubagentLines,
  emptySubTail,
  describeToolUse,
  type AgentEvent,
  type SubagentInfo
} from '../../src/main/services/agentParse'
import { createAgentTracker, slugOf } from '../../src/main/services/agentTracker'
import { aggregateWithAgents } from '../../src/shared/munu'

/**
 * Fixtures copy the line shapes found in real Claude Code 2.1.283 to 2.1.287
 * transcripts (message text trimmed): background launch ("Async agent launched
 * successfully"), team spawn ("Spawned successfully"), `<task-notification>` in its
 * three line shapes, `<teammate-message>` idle notices, and the subagent transcript.
 */
const SESS = 'a39ff0fc-0000-4000-8000-000000000001'
const CWD = '/Users/me/dockterm'
const iso = (s: number): string => new Date(Date.UTC(2026, 9, 2, 10, 0, s)).toISOString()
const at = (s: number): number => Date.parse(iso(s))

const spawn = (id: string, input: Record<string, unknown>, s: number): string =>
  JSON.stringify({
    type: 'assistant',
    uuid: `u-${id}`,
    isSidechain: false,
    cwd: CWD,
    sessionId: SESS,
    timestamp: iso(s),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input }] }
  })

const toolResult = (id: string, text: string, s: number, tur?: unknown): string =>
  JSON.stringify({
    type: 'user',
    sessionId: SESS,
    timestamp: iso(s),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] },
    ...(tur ? { toolUseResult: tur } : {})
  })

const ASYNC = (agentId: string): string =>
  `Async agent launched successfully.\nagentId: ${agentId} (internal ID - do not mention to user. Use SendMessage with to: '${agentId}' to continue this agent.)\nThe agent is working in the background. You will be notified automatically when it completes.\noutput_file: /private/tmp/claude-501/x/${agentId}.output`

const SPAWNED = (name: string, team: string): string =>
  `Spawned successfully.\nagent_id: ${name}@${team}\nname: ${name}\nThe agent is now running and will receive instructions via mailbox.`

const notification = (agentId: string, toolUseId: string, status: string, result: string): string =>
  `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>/tmp/x/${agentId}.output</output-file>\n<status>${status}</status>\nSummary: "Full review" ${status}\n<result>${result}</result>\n<usage><subagent_tokens>51234</subagent_tokens><tool_uses>31</tool_uses><duration_ms>418000</duration_ms></usage>\n</task-notification>`

const queueLine = (content: string, s: number, operation = 'enqueue'): string =>
  JSON.stringify({ type: 'queue-operation', operation, timestamp: iso(s), sessionId: SESS, content })

const userString = (content: string, s: number): string =>
  JSON.stringify({ type: 'user', timestamp: iso(s), sessionId: SESS, message: { role: 'user', content } })

const mateMsg = (name: string, body: unknown, s: number): string =>
  userString(
    `Another Claude session sent a message:\n<teammate-message teammate_id="${name}" color="cyan">${JSON.stringify(body)}</teammate-message>`,
    s
  )

const parseAll = (lines: string[]): AgentEvent[] => lines.flatMap((l) => parseAgentLine(l))

describe('background agents (run_in_background)', () => {
  const lines = [
    spawn('toolu_bg', { description: 'Full DockTerm review', run_in_background: 'true', prompt: 'review' }, 0),
    toolResult('toolu_bg', ASYNC('a111'), 1, { isAsync: true, status: 'async_launched', agentId: 'a111' })
  ]

  it('accepts a spawn without subagent_type and reads run_in_background as the string "true"', () => {
    const ev = parseAgentLine(lines[0])
    expect(ev[0]).toMatchObject({ kind: 'spawn', id: 'toolu_bg', background: true, type: 'general-purpose' })
  })

  it('the immediate async_launched result is a launch, NOT a completion', () => {
    const ev = parseAgentLine(lines[1])
    expect(ev).toEqual([expect.objectContaining({ kind: 'launch', id: 'toolu_bg', mode: 'background', agentId: 'a111' })])
    const snap = reduceActivity(parseAll(lines), at(30))
    expect(snap.agents[0]).toMatchObject({ kind: 'background', phase: 'running', agentId: 'a111' })
    expect(snap.activeCount).toBe(1)
  })

  it('stays running for minutes and ends only on the task-notification', () => {
    const ev = parseAll(lines)
    expect(reduceActivity(ev, at(600)).agents[0].phase).toBe('running')
    const done = [...ev, ...parseAgentLine(queueLine(notification('a111', 'toolu_bg', 'completed', 'All good'), 420))]
    const snap = reduceActivity(done, at(425))
    expect(snap.agents[0]).toMatchObject({ phase: 'done', ok: true, resultPreview: 'All good', durationMs: 418000, steps: 31 })
    expect(snap.activeCount).toBe(0)
  })

  it.each([
    ['queue-operation', (c: string) => queueLine(c, 420)],
    ['user string', (c: string) => userString(c, 420)],
    [
      'queued_command attachment',
      (c: string) => JSON.stringify({ type: 'attachment', timestamp: iso(420), attachment: { type: 'queued_command', prompt: c } })
    ]
  ])('reads the notification from a %s line', (_n, mk) => {
    const ev = parseAgentLine(mk(notification('a111', 'toolu_bg', 'completed', 'ok')))
    expect(ev).toEqual([expect.objectContaining({ kind: 'notify', agentId: 'a111', status: 'completed' })])
  })

  it('uses the summary when the result is only the "report was delivered" boilerplate', () => {
    const body = `<task-notification>\n<task-id>a111</task-id>\n<status>completed</status>\n<summary>Agent "Review" completed</summary>\n<result>This agent's report was delivered to you as a message from "a111". Read it there.</result>\n</task-notification>`
    expect(parseAgentLine(queueLine(body, 5))[0]).toMatchObject({ kind: 'notify', text: 'Agent "Review" completed' })
  })

  it('ignores the dequeue ("remove") copy of a notification', () => {
    expect(parseAgentLine(queueLine(notification('a111', 't', 'completed', 'ok'), 421, 'remove'))).toEqual([])
  })

  it('failed, killed and stopped end the agent as failed', () => {
    for (const status of ['failed', 'killed', 'stopped']) {
      const ev = [...parseAll(lines), ...parseAgentLine(queueLine(notification('a111', 'toolu_bg', status, 'x'), 50))]
      expect(reduceActivity(ev, at(55)).agents[0]).toMatchObject({ phase: 'failed', ok: false })
    }
  })

  it('a SendMessage resume brings a finished agent back to running', () => {
    const resume = JSON.stringify({
      type: 'user',
      timestamp: iso(100),
      sessionId: SESS,
      toolUseResult: { resumedAgentId: 'a111' },
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_sm', content: 'resumed' }] }
    })
    const ev = [...parseAll(lines), ...parseAgentLine(queueLine(notification('a111', 'toolu_bg', 'completed', 'ok'), 50)), ...parseAgentLine(resume)]
    expect(reduceActivity(ev, at(105)).agents[0].phase).toBe('running')
  })

  it('an async_launched result also marks a spawn that was not flagged as background', () => {
    const ev = parseAll([spawn('toolu_x', { subagent_type: 'reviewer', description: 'd', prompt: 'p' }, 0), toolResult('toolu_x', ASYNC('a222'), 1)])
    expect(reduceActivity(ev, at(5)).agents[0]).toMatchObject({ kind: 'background', phase: 'running', type: 'reviewer' })
  })
})

describe('foreground sub-agents', () => {
  it('run until their own tool_result, which carries the final answer', () => {
    const ev = parseAll([
      spawn('toolu_fg', { subagent_type: 'Explore', description: 'Map it', prompt: 'p' }, 0),
      toolResult('toolu_fg', 'The map: A then B.', 12)
    ])
    expect(reduceActivity(ev.slice(0, 1), at(5)).agents[0]).toMatchObject({ kind: 'subagent', phase: 'running' })
    expect(reduceActivity(ev, at(13)).agents[0]).toMatchObject({ kind: 'subagent', phase: 'done', ok: true, resultPreview: 'The map: A then B.', durationMs: 12000 })
  })
})

describe('team members', () => {
  const lines = [
    spawn('toolu_tm', { name: 'ai-model-researcher', team_name: 'session-07339782', description: 'research', prompt: 'p' }, 0),
    toolResult('toolu_tm', SPAWNED('ai-model-researcher', 'session-07339782'), 2, { status: 'teammate_spawned', name: 'ai-model-researcher' })
  ]

  it('spawned successfully is a launch of kind teammate with team and name', () => {
    const ev = parseAll(lines)
    expect(ev[1]).toMatchObject({ kind: 'launch', mode: 'teammate', agentId: 'ai-model-researcher', name: 'ai-model-researcher', teamName: 'session-07339782' })
    expect(reduceActivity(ev, at(10)).agents[0]).toMatchObject({ kind: 'teammate', phase: 'running', name: 'ai-model-researcher', teamName: 'session-07339782' })
  })

  it('goes idle on idle_notification and ends on teammate_terminated', () => {
    const idle = mateMsg('ai-model-researcher', { type: 'idle_notification', from: 'ai-model-researcher', idleReason: 'available', result: 'Report written' }, 60)
    const ev = [...parseAll(lines), ...parseAgentLine(idle)]
    const snap = reduceActivity(ev, at(65))
    expect(snap.agents[0]).toMatchObject({ phase: 'idle', resultPreview: 'Report written' })
    expect(snap.activeCount).toBe(0)
    const bye = userString(
      `<teammate-message teammate_id="system">${JSON.stringify({ type: 'teammate_terminated', message: 'ai-model-researcher has shut down.' })}</teammate-message>`,
      90
    )
    expect(reduceActivity([...ev, ...parseAgentLine(bye)], at(95)).agents[0]).toMatchObject({ phase: 'done' })
  })

  it('a teammate idle for a long time is no longer listed', () => {
    const idle = mateMsg('ai-model-researcher', { type: 'idle_notification', from: 'ai-model-researcher', result: 'x' }, 60)
    const ev = [...parseAll(lines), ...parseAgentLine(idle)]
    expect(reduceActivity(ev, at(60) + 11 * 60_000).agents).toHaveLength(0)
  })

  it('matches its own transcript by name and flips idle back to running when it grows', () => {
    const idle = mateMsg('ai-model-researcher', { type: 'idle_notification', from: 'ai-model-researcher', result: 'x' }, 60)
    const ev = [...parseAll(lines), ...parseAgentLine(idle)]
    const sub = (lastActiveAt: number): SubagentInfo => ({
      agentId: 'aai-model-researcher-1',
      sessionId: SESS,
      project: CWD,
      meta: { taskKind: 'in_process_teammate', name: 'ai-model-researcher', teamName: 'session-07339782', customAgentType: 'ai-engineer', color: 'cyan' },
      startedAt: at(1),
      lastActiveAt,
      steps: 7,
      action: 'WebSearch gemini pricing'
    })
    expect(reduceActivity(ev, at(65), {}, [sub(at(59))]).agents[0]).toMatchObject({ phase: 'idle', type: 'ai-engineer', color: 'cyan', steps: 7 })
    expect(reduceActivity(ev, at(80), {}, [sub(at(75))]).agents[0]).toMatchObject({ phase: 'running', action: 'WebSearch gemini pricing' })
  })
})

describe('the agent transcript tailer', () => {
  const asst = (name: string, input: unknown, s: number): string =>
    JSON.stringify({ type: 'assistant', isSidechain: true, agentId: 'a111', cwd: CWD, sessionId: SESS, timestamp: iso(s), message: { content: [{ type: 'tool_use', id: `t${s}`, name, input }] } })
  const user = (s: number): string =>
    JSON.stringify({ type: 'user', isSidechain: true, agentId: 'a111', timestamp: iso(s), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a "type":"tool_use" in plain output' }] } })

  it('counts tool calls and keeps the last action, across batches', () => {
    const st = emptySubTail()
    feedSubagentLines(st, [asst('Read', { file_path: '/a/b/agentParse.ts' }, 1), user(2), asst('Bash', { command: 'npm test', description: 'Run the tests' }, 3)])
    expect(st).toMatchObject({ steps: 2, action: 'Bash Run the tests', cwd: CWD })
    feedSubagentLines(st, [asst('Edit', { file_path: '/a/b/c/agentTracker.ts' }, 4)])
    expect(st).toMatchObject({ steps: 3, action: 'Edit agentTracker.ts' })
  })

  it('describes common tools with one short target', () => {
    expect(describeToolUse('Grep', { pattern: 'spawn_' })).toBe('Grep spawn_')
    expect(describeToolUse('WebFetch', { url: 'https://docs.example.com/x?y=1' })).toBe('WebFetch docs.example.com')
    expect(describeToolUse('Bash', { command: 'x'.repeat(200) }).length).toBeLessThan(60)
    expect(describeToolUse('Unknown', {})).toBe('Unknown')
  })
})

describe('staleness, orphans and closed sessions', () => {
  const lone = [spawn('toolu_s', { subagent_type: 'x', description: 'd', prompt: 'p' }, 0)]

  it('drops a running agent with no sign of life for 30 minutes', () => {
    expect(reduceActivity(parseAll(lone), at(0) + 31 * 60_000).agents).toHaveLength(0)
    expect(reduceActivity(parseAll(lone), at(0) + 20 * 60_000).agents).toHaveLength(1)
  })

  it('a transcript with no seen spawn shows as its kind from the meta file while it is written', () => {
    const sub: SubagentInfo = {
      agentId: 'a9',
      sessionId: SESS,
      project: CWD,
      meta: { agentType: 'reviewer', description: 'Old one', requestShape: 'background' },
      startedAt: at(0),
      lastActiveAt: at(100),
      steps: 4,
      action: 'Read x.ts'
    }
    expect(reduceActivity([], at(110), {}, [sub]).agents[0]).toMatchObject({ kind: 'background', phase: 'running', type: 'reviewer', steps: 4 })
    expect(reduceActivity([], at(100) + 10 * 60_000, {}, [sub]).agents).toHaveLength(0)
  })

  it('a closed Claude Code session ends its unfinished agents', () => {
    const snap = reduceActivity(parseAll(lone), at(40), { closedSessions: new Map([[SESS, at(30)]]) })
    expect(snap.agents[0]).toMatchObject({ phase: 'done', resultPreview: 'Session closed' })
    expect(snap.activeCount).toBe(0)
  })
})

describe('munu state with agents', () => {
  it('background agents keep an otherwise idle munu working; asking and done still win', () => {
    expect(aggregateWithAgents(['idle'], 0)).toBe('idle')
    expect(aggregateWithAgents(['idle'], 2)).toBe('working')
    expect(aggregateWithAgents([], 1)).toBe('working')
    expect(aggregateWithAgents(['asking'], 3)).toBe('asking')
    expect(aggregateWithAgents(['done', 'idle'], 3)).toBe('working')
    expect(aggregateWithAgents(['done', 'idle'], 0)).toBe('done')
  })
})

describe('createAgentTracker on a real directory layout', () => {
  function setup(): { root: string; projects: string; sessions: string; parent: string; subs: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'dockterm-agents-'))
    const projects = join(root, 'projects')
    const sessions = join(root, 'sessions')
    const proj = join(projects, slugOf(CWD))
    const subs = join(proj, SESS, 'subagents')
    mkdirSync(subs, { recursive: true })
    mkdirSync(sessions, { recursive: true })
    writeFileSync(join(sessions, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SESS, cwd: CWD, kind: 'interactive' }))
    return { root, projects, sessions, parent: join(proj, `${SESS}.jsonl`), subs, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }
  const now = (): number => Date.now()
  const stamp = (s: number): string => new Date(now() - s * 1000).toISOString()
  const asstTool = (name: string, input: unknown): string =>
    JSON.stringify({ type: 'assistant', isSidechain: true, cwd: CWD, sessionId: SESS, timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 'x', name, input }] } })

  it('follows a background agent from launch, through live steps, to its notification', async () => {
    const t = setup()
    try {
      const sp = JSON.stringify({ type: 'assistant', uuid: 'u1', cwd: CWD, sessionId: SESS, timestamp: stamp(60), message: { content: [{ type: 'tool_use', id: 'toolu_bg', name: 'Agent', input: { description: 'Review', run_in_background: 'true', prompt: 'p' } }] } })
      const ln = JSON.stringify({ type: 'user', sessionId: SESS, timestamp: stamp(59), message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bg', content: [{ type: 'text', text: ASYNC('a111') }] }] } })
      writeFileSync(t.parent, sp + '\n' + ln + '\n')
      writeFileSync(join(t.subs, 'agent-a111.meta.json'), JSON.stringify({ agentType: 'reviewer', description: 'Review', toolUseId: 'toolu_bg', requestShape: 'background' }))
      writeFileSync(join(t.subs, 'agent-a111.jsonl'), asstTool('Read', { file_path: '/x/one.ts' }) + '\n' + asstTool('Grep', { pattern: 'foo' }) + '\n')

      const tr = createAgentTracker({ projectsDir: t.projects, sessionsDir: t.sessions })
      expect(await tr.scan()).toBe(true)
      let a = tr.snapshot().agents[0]
      expect(a).toMatchObject({ kind: 'background', phase: 'running', steps: 2, action: 'Grep foo', agentId: 'a111' })

      // a half-written line must not be consumed, and only new bytes are read
      appendFileSync(join(t.subs, 'agent-a111.jsonl'), asstTool('Edit', { file_path: '/x/two.ts' }).slice(0, 30))
      await tr.scan()
      expect(tr.snapshot().agents[0].steps).toBe(2)
      appendFileSync(join(t.subs, 'agent-a111.jsonl'), asstTool('Edit', { file_path: '/x/two.ts' }).slice(30) + '\n')
      await tr.scan()
      a = tr.snapshot().agents[0]
      expect(a).toMatchObject({ steps: 3, action: 'Edit two.ts', phase: 'running' })

      appendFileSync(t.parent, queueLine(notification('a111', 'toolu_bg', 'completed', 'Review done'), 0).replace(iso(0), new Date().toISOString()) + '\n')
      await tr.scan()
      expect(tr.snapshot().agents[0]).toMatchObject({ phase: 'done', resultPreview: 'Review done' })
    } finally {
      t.cleanup()
    }
  })

  it('lists a teammate from its meta file and a stale old transcript is ignored', async () => {
    const t = setup()
    try {
      writeFileSync(t.parent, '')
      writeFileSync(join(t.subs, 'agent-amate-1.meta.json'), JSON.stringify({ agentType: 'writer', name: 'writer', taskKind: 'in_process_teammate', teamName: 'session-a39ff0fc', color: 'green', customAgentType: 'doc-writer' }))
      writeFileSync(join(t.subs, 'agent-amate-1.jsonl'), asstTool('Write', { file_path: '/x/doc.md' }) + '\n')
      writeFileSync(join(t.subs, 'agent-aold-1.meta.json'), JSON.stringify({ agentType: 'x', requestShape: 'background' }))
      writeFileSync(join(t.subs, 'agent-aold-1.jsonl'), asstTool('Read', { file_path: '/x/old.md' }) + '\n')
      const old = new Date(Date.now() - 3 * 3600_000)
      utimesSync(join(t.subs, 'agent-aold-1.jsonl'), old, old)

      const tr = createAgentTracker({ projectsDir: t.projects, sessionsDir: t.sessions })
      await tr.scan()
      const snap = tr.snapshot()
      expect(snap.agents).toHaveLength(1)
      expect(snap.agents[0]).toMatchObject({ kind: 'teammate', name: 'writer', teamName: 'session-a39ff0fc', color: 'green', type: 'doc-writer', action: 'Write doc.md', phase: 'running' })
    } finally {
      t.cleanup()
    }
  })
})
