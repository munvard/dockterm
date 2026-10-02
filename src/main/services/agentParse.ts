import type { AgentActivity, LiveAgent } from '@shared/types'

/**
 * Pure transcript to live-agent logic (no I/O, no electron) so it is unit-testable.
 *
 * Verified against Claude Code 2.1.283 to 2.1.287 transcripts on disk:
 *
 * - A spawn is a `tool_use` block named `Agent` (older builds: `Task`) on a
 *   `type:"assistant"` line. `input` has `description`, `prompt` and optionally
 *   `subagent_type`, `name` (named agent / team member) and `run_in_background`
 *   (the string "true" or a boolean). `subagent_type` is OFTEN ABSENT.
 * - The tool_result of that spawn comes back at once, in one of three shapes:
 *   foreground: the agent's final answer (ends the agent);
 *   background: "Async agent launched successfully. ... agentId: <id> ..." (the
 *     agent keeps running; it is NOT done);
 *   team member: "Spawned successfully. ... agent_id: <name>@<team> / name: <name>"
 *     (a long-lived in-process teammate; NOT done).
 * - A background agent really ends with a `<task-notification>` (task-id = agentId,
 *   `<status>` completed | failed | killed | stopped, `<result>`, `<usage>`), written
 *   to the parent transcript as a `queue-operation`, a `user` line whose content is
 *   a string, or an `attachment` (`queued_command`).
 * - A team member reports `idle_notification` (finished a task, waits for more),
 *   `shutdown_approved` and `teammate_terminated` as `<teammate-message>` user lines.
 * - Each agent also has its own transcript `<session>/subagents/agent-<id>.jsonl`
 *   plus `agent-<id>.meta.json`, which is what gives the live "doing now" line.
 */

export type AgentEvent =
  | {
      kind: 'spawn'
      id: string
      parentMsgId: string | null
      type: string
      description: string
      name: string | null
      background: boolean
      project: string
      projectLabel: string
      sessionId: string
      ts: number
    }
  | {
      kind: 'launch'
      id: string
      mode: 'background' | 'teammate'
      agentId: string
      name: string | null
      teamName: string | null
      sessionId: string
      ts: number
    }
  | { kind: 'result'; id: string; ts: number; ok: boolean; resultText: string }
  | {
      kind: 'notify'
      agentId: string
      toolUseId: string | null
      status: string
      text: string
      durationMs: number | null
      steps: number | null
      ts: number
    }
  | { kind: 'resume'; agentId: string; ts: number }
  | { kind: 'mate'; name: string; state: 'idle' | 'ended'; sessionId: string; text: string; ts: number }

const AGENT_TOOLS = new Set(['Agent', 'Task'])
const TEXT_MAX = 600

interface RawContent {
  type?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
  text?: unknown
}
interface RawLine {
  type?: string
  operation?: string
  uuid?: string
  cwd?: string
  sessionId?: string
  timestamp?: string
  content?: unknown
  attachment?: { type?: string; prompt?: unknown }
  toolUseResult?: unknown
  message?: { content?: unknown }
}

/** Last path segment of a cwd, for grouping ('/Users/me/dockterm' becomes 'dockterm'). */
export function labelOf(project: string): string {
  const segs = project.split(/[\\/]/).filter(Boolean)
  return segs.length ? segs[segs.length - 1] : project
}

/** Flatten a tool_result `content` (string | [{text}]) into plain text. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string'
          ? (c as { text: string }).text
          : ''
      )
      .join('')
  }
  return ''
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? m[1].trim() : null
}

/** The string content of a user/queue/attachment line, if it has one. */
function stringContent(o: RawLine): string {
  if (typeof o.message?.content === 'string') return o.message.content
  if (typeof o.content === 'string') return o.content
  if (typeof o.attachment?.prompt === 'string') return o.attachment.prompt
  return ''
}

/** The result text, unless it is only the "report was delivered as a message" boilerplate. */
function noteText(result: string | null, summary: string | null): string {
  if (result && !/^This agent's report was delivered/.test(result)) return result
  return summary || result || ''
}

function parseNotifications(text: string, ts: number): AgentEvent[] {
  const out: AgentEvent[] = []
  const re = /<task-notification>([\s\S]*?)<\/task-notification>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const body = m[1]
    const agentId = tag(body, 'task-id')
    if (!agentId) continue
    const usage = tag(body, 'usage') ?? ''
    const dur = /<duration_ms>(\d+)<\/duration_ms>/.exec(usage)
    const tools = /<tool_uses>(\d+)<\/tool_uses>/.exec(usage)
    out.push({
      kind: 'notify',
      agentId,
      toolUseId: tag(body, 'tool-use-id'),
      status: tag(body, 'status') ?? 'completed',
      text: noteText(tag(body, 'result'), tag(body, 'summary')).slice(0, TEXT_MAX),
      durationMs: dur ? Number(dur[1]) : null,
      steps: tools ? Number(tools[1]) : null,
      ts
    })
  }
  return out
}

function parseTeammateMessages(text: string, sessionId: string, ts: number): AgentEvent[] {
  const out: AgentEvent[] = []
  const re = /<teammate-message teammate_id="([^"]*)"[^>]*>\s*([\s\S]*?)\s*<\/teammate-message>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const body = m[2]
    if (body[0] !== '{') continue
    let j: { type?: unknown; from?: unknown; message?: unknown; result?: unknown }
    try {
      j = JSON.parse(body) as typeof j
    } catch {
      continue
    }
    const type = str(j.type)
    if (type === 'idle_notification') {
      const name = str(j.from) || m[1]
      out.push({ kind: 'mate', name, state: 'idle', sessionId, text: str(j.result).slice(0, TEXT_MAX), ts })
    } else if (type === 'shutdown_approved') {
      out.push({ kind: 'mate', name: str(j.from) || m[1], state: 'ended', sessionId, text: '', ts })
    } else if (type === 'teammate_terminated') {
      const nm = /^(.+?) has shut down/.exec(str(j.message))
      if (nm) out.push({ kind: 'mate', name: nm[1], state: 'ended', sessionId, text: '', ts })
    }
  }
  return out
}

/** Spawn launch result text, or null when the tool_result is a normal answer. */
function parseLaunch(text: string): { mode: 'background' | 'teammate'; agentId: string; name: string | null; teamName: string | null } | null {
  if (text.startsWith('Async agent launched')) {
    const id = /agentId:\s*([A-Za-z0-9_-]+)/.exec(text)
    if (id) return { mode: 'background', agentId: id[1], name: null, teamName: null }
  } else if (text.startsWith('Spawned successfully')) {
    const id = /agent_id:\s*([^\s@]+)@(\S+)/.exec(text)
    if (id) {
      const nm = /\nname:\s*(.+)/.exec(text)
      return { mode: 'teammate', agentId: id[1], name: nm ? nm[1].trim() : id[1], teamName: id[2] }
    }
  }
  return null
}

const truthy = (v: unknown): boolean => v === true || v === 'true'

/**
 * Parse one JSONL line into zero or more agent events (a line may spawn several).
 * `pending` (optional) is the set of spawn tool_use ids still waiting for their
 * result: when given, plain tool_result lines for anything else are skipped before
 * JSON.parse, which is what keeps tailing a busy transcript cheap.
 */
export function parseAgentLine(line: string, pending?: ReadonlySet<string>): AgentEvent[] {
  const s = line.trim()
  if (!s || s[0] !== '{') return []
  if (pending) {
    const interesting =
      s.includes('"Agent"') ||
      s.includes('"Task"') ||
      s.includes('<task-notification>') ||
      s.includes('<teammate-message') ||
      s.includes('resumedAgentId') ||
      (s.includes('"tool_result"') && [...pending].some((id) => s.includes(id)))
    if (!interesting) return []
  }
  let o: RawLine
  try {
    o = JSON.parse(s) as RawLine
  } catch {
    return []
  }
  const parsed = Date.parse(o.timestamp ?? '')
  const ts = Number.isFinite(parsed) ? parsed : 0
  const sessionId = str(o.sessionId)
  const out: AgentEvent[] = []

  const sc = stringContent(o)
  if (sc) {
    const t = sc.trimStart()
    if (t.startsWith('<task-notification>') && o.operation !== 'remove') {
      out.push(...parseNotifications(sc, ts))
    } else if (o.type === 'user' && t.includes('<teammate-message')) {
      out.push(...parseTeammateMessages(sc, sessionId, ts))
    }
    return out
  }

  const content = o.message?.content
  if (!Array.isArray(content)) return out
  const tur = o.toolUseResult as { resumedAgentId?: unknown } | undefined
  if (tur && typeof tur === 'object' && typeof tur.resumedAgentId === 'string') {
    out.push({ kind: 'resume', agentId: tur.resumedAgentId, ts })
  }
  for (const raw of content as RawContent[]) {
    const c = raw
    if (!c || typeof c !== 'object') continue
    if (c.type === 'tool_use' && typeof c.name === 'string' && AGENT_TOOLS.has(c.name) && c.input) {
      const inp = c.input
      const subagentType = str(inp.subagent_type)
      const name = str(inp.name)
      if (!subagentType && !name && !str(inp.description) && !str(inp.prompt)) continue
      const project = str(o.cwd)
      out.push({
        kind: 'spawn',
        id: str(c.id),
        parentMsgId: typeof o.uuid === 'string' ? o.uuid : null,
        type: subagentType || 'general-purpose',
        description: str(inp.description),
        name: name || null,
        background: truthy(inp.run_in_background),
        project,
        projectLabel: project ? labelOf(project) : 'unknown',
        sessionId,
        ts
      })
    } else if (c.type === 'tool_result' && typeof c.tool_use_id === 'string') {
      const text = textOf(c.content)
      const launch = parseLaunch(text)
      if (launch) {
        out.push({ kind: 'launch', id: c.tool_use_id, sessionId, ts, ...launch })
      } else {
        out.push({ kind: 'result', id: c.tool_use_id, ts, ok: c.is_error !== true, resultText: text.slice(0, TEXT_MAX * 4) })
      }
    }
  }
  return out
}

// ----- the agent's own transcript (subagents/agent-<id>.jsonl) -----

export interface SubTail {
  steps: number
  action: string | null
  actionTs: number
  cwd: string
}

export const emptySubTail = (): SubTail => ({ steps: 0, action: null, actionTs: 0, cwd: '' })

const clip = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** 'Edit agentParse.ts', 'Bash npm test', 'Grep spawn_', one short line per tool call. */
export function describeToolUse(name: string, input: Record<string, unknown> | undefined): string {
  const i = input ?? {}
  const pick = (...keys: string[]): string => {
    for (const k of keys) if (typeof i[k] === 'string' && i[k]) return i[k] as string
    return ''
  }
  let target = ''
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      target = baseName(pick('file_path', 'notebook_path', 'path'))
      break
    case 'Bash':
    case 'PowerShell':
      target = clip(pick('description', 'command'), 48)
      break
    case 'Grep':
    case 'Glob':
      target = clip(pick('pattern'), 40)
      break
    case 'WebFetch': {
      const u = pick('url')
      try {
        target = new URL(u).hostname
      } catch {
        target = clip(u, 40)
      }
      break
    }
    case 'WebSearch':
      target = clip(pick('query'), 40)
      break
    case 'Agent':
    case 'Task':
      target = clip(pick('description', 'name'), 40)
      break
    case 'SendMessage':
      target = clip(pick('to'), 30)
      break
    default:
      target = clip(pick('description', 'file_path', 'path', 'pattern', 'query', 'command', 'prompt'), 40)
  }
  return target ? `${name} ${target}` : name
}

const TOOL_USE_MARK = '"type":"tool_use"'

function countOf(hay: string, needle: string): number {
  let n = 0
  let at = hay.indexOf(needle)
  while (at !== -1) {
    n++
    at = hay.indexOf(needle, at + needle.length)
  }
  return n
}

/**
 * Feed complete JSONL lines of an agent's own transcript: counts tool calls with a
 * plain substring count (no JSON.parse per line) and parses only the LAST tool_use
 * line of the batch for the current action.
 */
export function feedSubagentLines(state: SubTail, lines: string[]): void {
  let lastToolLine = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.includes(TOOL_USE_MARK)) continue
    state.steps += countOf(l, TOOL_USE_MARK)
    if (l.includes('"type":"assistant"') || l.includes('"role":"assistant"')) lastToolLine = i
  }
  if (lastToolLine >= 0) {
    try {
      const o = JSON.parse(lines[lastToolLine]) as RawLine
      const blocks = Array.isArray(o.message?.content) ? (o.message!.content as RawContent[]) : []
      for (let k = blocks.length - 1; k >= 0; k--) {
        const b = blocks[k]
        if (b?.type === 'tool_use' && typeof b.name === 'string') {
          state.action = describeToolUse(b.name, b.input)
          const p = Date.parse(o.timestamp ?? '')
          if (Number.isFinite(p)) state.actionTs = p
          if (typeof o.cwd === 'string' && o.cwd) state.cwd = o.cwd
          break
        }
      }
    } catch {
      // a half-written or unusual line: keep the previous action
    }
  }
  if (!state.cwd) {
    for (let i = lines.length - 1; i >= 0 && i > lines.length - 4; i--) {
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(lines[i])
      if (m) {
        try {
          state.cwd = JSON.parse(`"${m[1]}"`) as string
        } catch {
          // ignore
        }
        break
      }
    }
  }
}

/** What the `agent-<id>.meta.json` file next to an agent transcript holds. */
export interface SubMeta {
  agentType?: string
  customAgentType?: string
  description?: string
  name?: string
  toolUseId?: string
  requestShape?: string
  taskKind?: string
  teamName?: string
  color?: string
  parentAgentId?: string
}

/** Everything the service knows about one live agent transcript. */
export interface SubagentInfo {
  agentId: string
  sessionId: string
  project: string
  meta: SubMeta
  startedAt: number
  lastActiveAt: number
  steps: number
  action: string | null
}

// ----- reducing events + transcripts into the snapshot -----

export interface ReduceOpts {
  /** Read the agent's final result text (else metadata-only). Default true. */
  streamOutput?: boolean
  /** Drop finished agents this long after they end (ms). Default 30s. */
  retainMs?: number
  /** Cap the stored result preview (chars). Default 280. */
  resultMax?: number
  /** A running agent with no sign of life for this long is dropped. Default 30 min. */
  staleMs?: number
  /** A team member idle for this long is no longer listed. Default 10 min. */
  idleKeepMs?: number
  /** A transcript-only agent (no spawn seen) counts as running this long after its last write. Default 5 min. */
  orphanLiveMs?: number
  /** Sessions whose Claude Code process has exited, with the time it was noticed. */
  closedSessions?: ReadonlyMap<string, number>
}

interface Rec extends LiveAgent {
  _lastEvent: number
  _idleAt: number | null
  _mateKey: string | null
}

const RESUME_SLACK_MS = 3_000

const previewOf = (text: string, max: number, on: boolean): string | null =>
  on ? text.replace(/\s+/g, ' ').trim().slice(0, max) || null : null

function blank(id: string): Rec {
  return {
    id,
    parentMsgId: null,
    type: 'general-purpose',
    description: '',
    project: '',
    projectLabel: 'unknown',
    sessionId: '',
    startedAt: 0,
    endedAt: null,
    phase: 'running',
    durationMs: null,
    ok: null,
    resultPreview: null,
    kind: 'subagent',
    name: null,
    teamName: null,
    agentId: null,
    color: null,
    action: null,
    steps: 0,
    lastActiveAt: null,
    _lastEvent: 0,
    _idleAt: null,
    _mateKey: null
  }
}

const finish = (a: Rec, ts: number, phase: 'done' | 'failed', preview: string | null, durationMs?: number | null): void => {
  a.endedAt = ts
  a.durationMs = durationMs ?? (a.startedAt ? Math.max(0, ts - a.startedAt) : null)
  a.ok = phase === 'done'
  a.phase = phase
  a.resultPreview = preview
}

/**
 * Fold the ordered event list (plus what the agents' own transcripts show) into
 * the live snapshot.
 *
 * - foreground: running until its tool_result.
 * - background: running from the launch result until its `<task-notification>`.
 * - teammate: running while working, `idle` after an idle_notification until its
 *   transcript grows again, gone after shutdown.
 * Finished agents linger for `retainMs`, then drop.
 */
export function reduceActivity(
  events: AgentEvent[],
  now: number,
  opts: ReduceOpts = {},
  subs: SubagentInfo[] = []
): AgentActivity {
  const streamOutput = opts.streamOutput !== false
  const retainMs = opts.retainMs ?? 30_000
  const resultMax = opts.resultMax ?? 280
  const staleMs = opts.staleMs ?? 30 * 60_000
  const idleKeepMs = opts.idleKeepMs ?? 10 * 60_000
  const orphanLiveMs = opts.orphanLiveMs ?? 5 * 60_000
  const closed = opts.closedSessions

  const map = new Map<string, Rec>()
  const order: string[] = []
  const byAgentId = new Map<string, Rec>()
  const byMate = new Map<string, Rec>()

  for (const e of events) {
    if (e.kind === 'spawn') {
      if (!e.id) continue
      let a = map.get(e.id)
      if (!a) {
        a = blank(e.id)
        map.set(e.id, a)
        order.push(e.id)
      }
      a.parentMsgId = e.parentMsgId
      a.type = e.type
      a.description = e.description
      a.name = e.name ?? a.name
      a.project = e.project
      a.projectLabel = e.projectLabel
      a.sessionId = e.sessionId
      a.startedAt = e.ts
      a._lastEvent = e.ts
      a.kind = e.background ? 'background' : 'subagent'
    } else if (e.kind === 'launch') {
      const a = map.get(e.id)
      if (!a) continue
      a.kind = e.mode
      a.agentId = e.agentId
      a._lastEvent = e.ts
      if (e.mode === 'teammate') {
        a.name = e.name ?? a.name
        a.teamName = e.teamName
        a._mateKey = `${a.sessionId || e.sessionId}|${a.name}`
        byMate.set(a._mateKey, a)
      } else {
        byAgentId.set(e.agentId, a)
      }
    } else if (e.kind === 'result') {
      const a = map.get(e.id)
      if (!a || a.kind !== 'subagent') continue
      finish(a, e.ts, e.ok ? 'done' : 'failed', previewOf(e.resultText, resultMax, streamOutput))
    } else if (e.kind === 'notify') {
      const a = byAgentId.get(e.agentId)
      if (!a) continue
      const ok = e.status === 'completed'
      finish(a, e.ts, ok ? 'done' : 'failed', previewOf(e.text, resultMax, streamOutput), e.durationMs)
      if (e.steps != null) a.steps = Math.max(a.steps, e.steps)
      a._lastEvent = e.ts
    } else if (e.kind === 'resume') {
      const a = byAgentId.get(e.agentId)
      if (!a) continue
      a.endedAt = null
      a.durationMs = null
      a.ok = null
      a.phase = 'running'
      a.resultPreview = null
      a._lastEvent = e.ts
    } else {
      const a = byMate.get(`${e.sessionId}|${e.name}`)
      if (!a) continue
      a._lastEvent = e.ts
      if (e.state === 'idle') {
        a._idleAt = e.ts
        a.resultPreview = previewOf(e.text, resultMax, streamOutput)
      } else {
        finish(a, e.ts, 'done', a.resultPreview)
      }
    }
  }

  // Attach each agent's own transcript (current action, steps, liveness).
  const used = new Set<SubagentInfo>()
  const subFor = (a: Rec): SubagentInfo | undefined => {
    let best: SubagentInfo | undefined
    for (const s of subs) {
      const hit =
        (s.meta.toolUseId && s.meta.toolUseId === a.id) ||
        (a.agentId && a.kind !== 'teammate' && s.agentId === a.agentId) ||
        (a.kind === 'teammate' &&
          s.meta.taskKind === 'in_process_teammate' &&
          s.meta.name === a.name &&
          s.sessionId === a.sessionId &&
          (!s.meta.teamName || !a.teamName || s.meta.teamName === a.teamName))
      if (hit && (!best || s.startedAt > best.startedAt)) best = s
    }
    return best
  }
  for (const id of order) {
    const a = map.get(id)!
    const s = subFor(a)
    if (!s) continue
    used.add(s)
    a.agentId = a.agentId ?? s.agentId
    a.steps = Math.max(a.steps, s.steps)
    a.action = s.action
    a.lastActiveAt = s.lastActiveAt
    if (!a.project && s.project) {
      a.project = s.project
      a.projectLabel = labelOf(s.project)
    }
    if (s.meta.color) a.color = s.meta.color
    if (a.kind === 'teammate' && s.meta.customAgentType) a.type = s.meta.customAgentType
    if (!a.name && s.meta.name) a.name = s.meta.name
    if (!a.teamName && s.meta.teamName) a.teamName = s.meta.teamName
    if (!a.startedAt) a.startedAt = s.startedAt
    // Its transcript grew after it was marked finished: it was resumed.
    if (a.endedAt != null && a.kind !== 'subagent' && s.lastActiveAt > a.endedAt + RESUME_SLACK_MS && s.lastActiveAt >= now - orphanLiveMs) {
      a.endedAt = null
      a.durationMs = null
      a.ok = null
      a.phase = 'running'
    }
  }

  // Agents whose spawn we never saw (older than the tail we read): rebuild from
  // their meta file, and only while their transcript is still being written.
  for (const s of subs) {
    if (used.has(s)) continue
    const m = s.meta
    const kind = m.taskKind === 'in_process_teammate' ? 'teammate' : m.requestShape === 'background' ? 'background' : 'subagent'
    // A team member without an idle signal is idle after a short quiet spell.
    if (s.lastActiveAt < now - (kind === 'teammate' ? Math.min(orphanLiveMs, 120_000) : orphanLiveMs)) continue
    const key = `sub:${s.agentId}`
    const a = blank(key)
    a.kind = kind
    a.type = m.customAgentType || m.agentType || 'general-purpose'
    a.description = m.description ?? ''
    a.name = m.name ?? null
    a.teamName = m.teamName ?? null
    a.color = m.color ?? null
    a.agentId = s.agentId
    a.sessionId = s.sessionId
    a.project = s.project
    a.projectLabel = s.project ? labelOf(s.project) : 'unknown'
    a.startedAt = s.startedAt
    a.steps = s.steps
    a.action = s.action
    a.lastActiveAt = s.lastActiveAt
    a._lastEvent = s.lastActiveAt
    map.set(key, a)
    order.push(key)
  }

  const kept: LiveAgent[] = []
  for (const id of order) {
    const a = map.get(id)
    if (!a) continue
    if (a.endedAt == null) {
      const closedAt = closed?.get(a.sessionId)
      if (closedAt != null) {
        finish(a, closedAt, 'done', 'Session closed')
      } else {
        const seen = Math.max(a.startedAt, a._lastEvent, a.lastActiveAt ?? 0)
        if (a.kind === 'teammate' && a._idleAt != null && (a.lastActiveAt ?? 0) <= a._idleAt + RESUME_SLACK_MS) {
          if (now - a._idleAt > idleKeepMs) continue
          a.phase = 'idle'
        } else if (seen > 0 && now - seen > staleMs) {
          continue
        } else {
          a.phase = 'running'
        }
      }
    }
    if (a.endedAt != null && now - a.endedAt > retainMs) continue
    kept.push(stripInternal(a))
  }
  const agents = kept.sort((x, y) => y.startedAt - x.startedAt)

  const running = agents.filter((a) => a.phase === 'running')
  const byProjMap = new Map<string, { project: string; label: string; count: number }>()
  for (const a of running) {
    const e = byProjMap.get(a.project) ?? { project: a.project, label: a.projectLabel, count: 0 }
    e.count++
    byProjMap.set(a.project, e)
  }
  const byProject = [...byProjMap.values()].sort((a, b) => b.count - a.count)

  return { updatedAt: now, agents, activeCount: running.length, byProject }
}

function stripInternal(a: Rec): LiveAgent {
  const { _lastEvent, _idleAt, _mateKey, ...rest } = a
  void _lastEvent
  void _idleAt
  void _mateKey
  return rest
}
