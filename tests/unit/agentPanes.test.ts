import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPidOwner, paneWork, parseProcessTable, ptyForPid } from '../../src/main/services/agentPanes'
import { parseAgentLine, reduceActivity } from '../../src/main/services/agentParse'
import { activityKeys, type LiveSession } from '../../src/main/services/agentTracker'
import { aggregateWithAgents, effectivePaneState } from '../../src/shared/munu'
import { busyLeaves, useMunuStore } from '@renderer/state/useMunuStore'
import type { LiveAgent } from '@shared/types'

const agent = (sessionId: string, phase: LiveAgent['phase']): LiveAgent =>
  ({ id: `${sessionId}-${phase}`, sessionId, phase }) as unknown as LiveAgent

describe('pane attribution', () => {
  // a DockTerm pane: pty shell 100 -> claude 110 (sometimes behind a wrapper 105)
  const table = parseProcessTable('  1     0\n100     1\r\n105   100\n110   105\n200     1\n210   200\njunk line\n')
  const ptys = new Map([[100, 'pty-1']])

  it('parses ps and PowerShell "pid ppid" lines, skipping anything else', () => {
    expect(table.get(110)).toBe(105)
    expect(table.get(100)).toBe(1)
    expect(table.size).toBe(6)
  })

  it('walks up from a Claude pid to the pane shell that started it', () => {
    expect(ptyForPid(110, table, ptys)).toBe('pty-1')
    expect(ptyForPid(100, table, ptys)).toBe('pty-1')
    expect(ptyForPid(210, table, ptys)).toBeNull()
    expect(ptyForPid(999, table, ptys)).toBeNull()
  })

  it('stops on a parent cycle instead of looping', () => {
    expect(ptyForPid(5, new Map([[5, 6], [6, 5]]), ptys)).toBeNull()
  })
})

describe('paneWork', () => {
  const sessions: LiveSession[] = [
    { pid: 110, sessionId: 'S1', status: 'idle' },
    { pid: 120, sessionId: 'S2', status: 'busy' },
    { pid: 130, sessionId: 'S3', status: 'shell' },
    { pid: 210, sessionId: 'OUT', status: 'busy' },
    { pid: 300, sessionId: 'NEW', status: 'idle' }
  ]
  const owner = (pid: number): string | null | undefined =>
    ({ 110: 'pty-1', 120: 'pty-2', 130: 'pty-3', 210: null })[pid as 110]

  it('a pane is busy when its Claude says busy, or an agent it started still runs', () => {
    const w = paneWork(sessions, owner, [agent('S1', 'running'), agent('S3', 'done')])
    expect(w.busyPtys).toEqual(['pty-1', 'pty-2'])
  })

  it('a background shell alone does not make a pane busy', () => {
    expect(paneWork(sessions, owner, []).busyPtys).not.toContain('pty-3')
  })

  it('splits running agents of other sessions into outside DockTerm and not placed yet', () => {
    const w = paneWork(sessions, owner, [agent('OUT', 'running'), agent('NEW', 'running'), agent('NEW', 'running'), agent('S1', 'running'), agent('S2', 'failed')])
    expect(w.outsideRunning).toBe(1)
    expect(w.unattributedRunning).toBe(2)
    expect(w.busyPtys).toEqual(['pty-1', 'pty-2'])
  })
})

describe('createPidOwner', () => {
  it('reads the process table once per new pid and caches the answer', async () => {
    let now = 0
    const read = vi.fn(async () => parseProcessTable('100 1\n110 100\n210 1'))
    const own = createPidOwner(read, () => [{ id: 'pty-1', pid: 100 }], 2000, () => now)
    expect(await own.refresh([110, 210, 777])).toBe(true)
    expect(own.owner(110)).toBe('pty-1')
    expect(own.owner(210)).toBeNull()
    expect(own.owner(777)).toBeNull() // exited before the read: never re-read for it
    now = 10_000
    expect(await own.refresh([110, 210, 777])).toBe(false)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('throttles reads, leaves a pid unknown when the read fails, and forgets dead pids and ptys', async () => {
    let now = 0
    let fail = true
    let ptys = [{ id: 'pty-1', pid: 100 }]
    const read = vi.fn(async () => {
      if (fail) throw new Error('ps failed')
      return parseProcessTable('100 1\n110 100')
    })
    const own = createPidOwner(read, () => ptys, 2000, () => now)
    await own.refresh([110])
    expect(own.owner(110)).toBeUndefined()
    fail = false
    now = 500
    await own.refresh([110])
    expect(read).toHaveBeenCalledTimes(1)
    now = 2500
    await own.refresh([110])
    expect(own.owner(110)).toBe('pty-1')
    ptys = []
    await own.refresh([110])
    expect(own.owner(110)).toBeUndefined()
    await own.refresh([])
    expect(own.owner(110)).toBeUndefined()
  })
})

describe('createPidOwner backoff', () => {
  it('doubles the wait after each failed read, caps it, and resets after a success', async () => {
    let now = 0
    let fail = true
    const read = vi.fn(async () => {
      if (fail) throw new Error('wmi blocked')
      return parseProcessTable('100 1\n110 100')
    })
    const own = createPidOwner(read, () => [{ id: 'pty-1', pid: 100 }], 1000, () => now, 5000)
    const at = async (t: number): Promise<void> => {
      now = t
      await own.refresh([110])
    }
    await at(0) // fail 1, next gap 1000
    await at(900)
    expect(read).toHaveBeenCalledTimes(1)
    await at(1000) // fail 2, next gap 2000
    await at(2999)
    expect(read).toHaveBeenCalledTimes(2)
    await at(3000) // fail 3, next gap 4000
    await at(6999)
    expect(read).toHaveBeenCalledTimes(3)
    await at(7000) // fail 4, gap capped at 5000
    await at(11_999)
    expect(read).toHaveBeenCalledTimes(4)
    fail = false
    await at(12_000)
    expect(read).toHaveBeenCalledTimes(5)
    expect(own.owner(110)).toBe('pty-1')
  })
})

describe('munu state rule', () => {
  it('a pane waiting on its agents is working; a question still wins', () => {
    expect(effectivePaneState('idle', true)).toBe('working')
    expect(effectivePaneState('idle', false)).toBe('idle')
    expect(effectivePaneState('working', false)).toBe('working')
    expect(effectivePaneState('asking', true)).toBe('asking')
  })

  it('agents not matched to a pane hold back the smile but not a question', () => {
    expect(aggregateWithAgents(['done'], 1)).toBe('working')
    expect(aggregateWithAgents(['asking', 'done'], 1)).toBe('asking')
    expect(aggregateWithAgents(['done'], 0)).toBe('done')
    expect(aggregateWithAgents(['done'], 0, 3)).toBe('done')
    expect(aggregateWithAgents(['idle'], 0, 3)).toBe('working')
  })

  it('maps busy ptys to the leaves showing them', () => {
    const ptyOf = (l: string): string | null => ({ a: 'pty-1', b: 'pty-2' })[l as 'a'] ?? null
    expect(busyLeaves(['a', 'b', 'c'], ['pty-2', 'pty-9'], ptyOf)).toEqual({ b: true })
    expect(busyLeaves(['a'], undefined, ptyOf)).toEqual({})
  })
})

describe('the done smile follows delegated work', () => {
  const L = 'leaf-agents'
  const st = () => useMunuStore.getState()
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    st().removePane(L)
    st().setBusyLeaves({})
    vi.useRealTimers()
  })

  it('no smile while the main Claude sits idle and its agent runs; one smile when the agent ends', () => {
    st().setPaneStatus(L, 't', 'working', null)
    st().setBusyLeaves({ [L]: true })
    st().setPaneStatus(L, 't', 'idle', null) // turn ended, background agent still running
    vi.advanceTimersByTime(30_000)
    expect(st().done[L]).toBeFalsy()
    expect(st().paneState(L)).toBe('working')
    expect(st().munuState()).toBe('working')

    st().setBusyLeaves({}) // the last agent ended
    vi.advanceTimersByTime(1000)
    expect(st().done[L]).toBeFalsy()
    vi.advanceTimersByTime(500)
    expect(st().done[L]).toBe(true)
    expect(st().munuState()).toBe('done')
    vi.advanceTimersByTime(3000)
    expect(st().done[L]).toBe(false)
    expect(st().munuState()).toBe('idle')
  })

  it('work that comes back before the settle (or during the smile) cancels it', () => {
    st().setPaneStatus(L, 't', 'working', null)
    st().setPaneStatus(L, 't', 'idle', null)
    vi.advanceTimersByTime(800)
    st().setBusyLeaves({ [L]: true }) // a foreground sub-agent started, screen still quiet
    vi.advanceTimersByTime(5000)
    expect(st().done[L]).toBeFalsy()

    st().setBusyLeaves({})
    vi.advanceTimersByTime(1500)
    expect(st().done[L]).toBe(true)
    st().setBusyLeaves({ [L]: true })
    expect(st().done[L]).toBe(false)
    expect(st().munuState()).toBe('working')
  })

  it('an idle re-report does not cancel a pending smile', () => {
    st().setPaneStatus(L, 't', 'working', null)
    st().setPaneStatus(L, 't', 'idle', null)
    vi.advanceTimersByTime(700)
    st().setPaneStatus(L, 't', 'idle', null)
    vi.advanceTimersByTime(800)
    expect(st().done[L]).toBe(true)
  })
})

describe('replay of a real Claude Code 2.1.287 transcript (agent that parks on its own background shell)', () => {
  const lines = readFileSync(join(__dirname, '..', 'fixtures', 'agent-parked-real.jsonl'), 'utf8').split('\n').filter(Boolean)
  const events = lines.flatMap((l) => parseAgentLine(l))
  const ts = (i: number): number => Date.parse(JSON.parse(lines[i]).timestamp)
  const phaseAt = (n: number, now: number) => reduceActivity(events.slice(0, n), now).agents[0]?.phase

  it('stays running through the interim "stopped with background work still running" notification', () => {
    const upTo = (i: number): number => events.filter((e) => 'ts' in e && (e as { ts: number }).ts <= ts(i)).length
    expect(phaseAt(upTo(1), ts(1) + 1000)).toBe('running')
    expect(phaseAt(upTo(2), ts(2) + 1000)).toBe('running')
    expect(phaseAt(upTo(4), ts(4) + 1000)).toBe('running')
  })

  it('ends on the final notification', () => {
    const snap = reduceActivity(events, ts(5) + 1000)
    expect(snap.agents[0]).toMatchObject({ phase: 'done', ok: true })
    expect(snap.activeCount).toBe(0)
  })
})

describe('activity broadcast keys', () => {
  const snap = (over: Partial<LiveAgent> = {}, busyPtys: string[] = []) => ({
    updatedAt: 1,
    activeCount: 1,
    byProject: [],
    busyPtys,
    agents: [{ id: 't1', phase: 'running', steps: 3, action: 'Read a.ts', lastActiveAt: 100, ...over } as unknown as LiveAgent]
  })

  it('ignores fields no window renders (timestamps, transcript growth)', () => {
    const a = activityKeys(snap())
    expect(activityKeys({ ...snap({ lastActiveAt: 999 }), updatedAt: 50 })).toEqual(a)
  })

  it('puts steps and action in detail, phase and busy panes in structure', () => {
    const a = activityKeys(snap())
    const step = activityKeys(snap({ steps: 4, action: 'Edit b.ts' }))
    expect(step.structure).toBe(a.structure)
    expect(step.detail).not.toBe(a.detail)
    expect(activityKeys(snap({ phase: 'done' })).structure).not.toBe(a.structure)
    expect(activityKeys(snap({}, ['pty-1'])).structure).not.toBe(a.structure)
  })
})
