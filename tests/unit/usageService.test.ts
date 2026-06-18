import { describe, it, expect } from 'vitest'
import {
  parseUsageLine,
  parseResetClock,
  parseLimitLine,
  calibrate5hLimit,
  buildSnapshot,
  computeWindow,
  prettyModel,
  type UsageRecord
} from '@main/services/usageService'

const line = (o: unknown): string => JSON.stringify(o)

describe('parseUsageLine', () => {
  it('parses an assistant usage line', () => {
    const rec = parseUsageLine(
      line({
        type: 'assistant',
        timestamp: '2026-06-18T10:00:00.000Z',
        cwd: '/Users/x/proj',
        requestId: 'req1',
        message: {
          id: 'msg1',
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            cache_read_input_tokens: 100
          }
        }
      })
    )
    expect(rec).not.toBeNull()
    expect(rec).toMatchObject({
      id: 'msg1:req1',
      model: 'Opus',
      project: '/Users/x/proj',
      projectLabel: 'proj',
      input: 10,
      output: 20,
      cacheCreate: 5,
      cacheRead: 100
    })
  })

  it('ignores non-assistant lines, bad JSON, and missing usage', () => {
    expect(parseUsageLine(line({ type: 'user', message: { content: 'hi' } }))).toBeNull()
    expect(parseUsageLine('{ not json')).toBeNull()
    expect(parseUsageLine('')).toBeNull()
    expect(parseUsageLine(line({ type: 'assistant', message: { model: 'x' } }))).toBeNull()
  })

  it('prettyModel groups versions', () => {
    expect(prettyModel('claude-opus-4-8')).toBe('Opus')
    expect(prettyModel('claude-sonnet-4-6')).toBe('Sonnet')
    expect(prettyModel('claude-haiku-4-5')).toBe('Haiku')
    expect(prettyModel('claude-future-9')).toBe('future-9')
  })
})

describe('parseResetClock', () => {
  const base = new Date(2026, 5, 18, 13, 0, 0, 0).getTime() // local 1:00pm

  it('parses an on-the-hour pm reset to the next occurrence', () => {
    const r = parseResetClock('You’ve hit your session limit · resets 7pm', base)
    expect(r).not.toBeNull()
    expect(new Date(r!).getHours()).toBe(19)
    expect(new Date(r!).getMinutes()).toBe(0)
    expect(r!).toBeGreaterThan(base)
  })

  it('parses a minute-precise am reset and rolls to the next day when already past', () => {
    const r = parseResetClock('resets 7:40am (Asia/Yerevan)', base)
    expect(new Date(r!).getHours()).toBe(7)
    expect(new Date(r!).getMinutes()).toBe(40)
    expect(r!).toBeGreaterThan(base) // 7:40am already passed today -> tomorrow
    expect(r! - base).toBeLessThan(24 * 3600_000)
  })

  it('returns null when no reset clock is present', () => {
    expect(parseResetClock('some unrelated text', base)).toBeNull()
  })
})

describe('parseLimitLine', () => {
  it('extracts ts + resetAt from a 429 session-limit line', () => {
    const ts = new Date(2026, 5, 18, 13, 0, 0, 0).getTime()
    const lim = JSON.stringify({
      type: 'assistant',
      error: 'rate_limit',
      apiErrorStatus: 429,
      timestamp: new Date(ts).toISOString(),
      message: { content: [{ type: 'text', text: "You've hit your session limit · resets 7pm" }] }
    })
    const rec = parseLimitLine(lim)
    expect(rec).not.toBeNull()
    expect(rec!.kind).toBe('session')
    expect(new Date(rec!.resetAt).getHours()).toBe(19)
    expect(rec!.ts).toBe(ts)
  })

  it('ignores non-rate-limit lines', () => {
    expect(parseLimitLine(JSON.stringify({ type: 'assistant', message: { content: [] } }))).toBeNull()
    expect(parseLimitLine('not json')).toBeNull()
  })
})

describe('calibrate5hLimit', () => {
  const mk = (ts: number, output: number): UsageRecord => ({
    id: `m${ts}:r`,
    ts,
    model: 'Opus',
    project: 'p',
    projectLabel: 'p',
    input: 0,
    output,
    cacheCreate: 0,
    cacheRead: 0
  })

  it('uses the weighted usage at the most recent hit as the limit (within clamp band)', () => {
    const hitTs = new Date(2026, 5, 18, 13, 0, 0, 0).getTime()
    // output is weighted x5; 200 output -> 1000 weighted, inside [fallback/4, fallback*4].
    const records = [mk(hitTs - 3600_000, 200), mk(hitTs - 100, 0)]
    const hits = [{ ts: hitTs, resetAt: hitTs + 5 * 3600_000, kind: 'session' as const }]
    expect(calibrate5hLimit(records, hits, 2000)).toBe(1000)
  })

  it('falls back when there are no hits', () => {
    expect(calibrate5hLimit([], [], 97_000_000)).toBe(97_000_000)
  })

  it('clamps wild calibrations to the fallback band', () => {
    const hitTs = new Date(2026, 5, 18, 13, 0, 0, 0).getTime()
    const records = [mk(hitTs - 100, 1_000_000_000)] // absurdly large
    const hits = [{ ts: hitTs, resetAt: hitTs + 1, kind: 'session' as const }]
    expect(calibrate5hLimit(records, hits, 1000)).toBe(4000) // fallback * 4
  })
})

describe('buildSnapshot', () => {
  const now = Date.parse('2026-06-18T12:00:00.000Z')
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const rec = (over: Partial<UsageRecord>): UsageRecord => ({
    id: Math.random().toString(36),
    ts: now,
    model: 'Opus',
    project: '/p',
    projectLabel: 'p',
    input: 1,
    output: 1,
    cacheCreate: 0,
    cacheRead: 0,
    ...over
  })

  it('flags empty when there are no records', () => {
    const s = buildSnapshot([], now)
    expect(s.empty).toBe(true)
    expect(s.daily).toHaveLength(30)
    expect(s.today.totalTokens).toBe(0)
  })

  it('buckets records across the time windows', () => {
    const records = [
      rec({ ts: now - HOUR, input: 100, output: 0 }), // today + last5h
      rec({ ts: now - 8 * HOUR, input: 10, output: 0 }), // today, NOT last5h
      rec({ ts: now - 3 * DAY, input: 1, output: 0 }), // last7d + 30d, not today
      rec({ ts: now - 20 * DAY, input: 1, output: 0 }) // last30d only
    ]
    const s = buildSnapshot(records, now)
    expect(s.last5h.totalTokens).toBe(100)
    expect(s.last7d.totalTokens).toBe(111)
    expect(s.last30d.totalTokens).toBe(112)
    expect(s.allTime.totalTokens).toBe(112)
    expect(s.empty).toBe(false)
  })

  it('aggregates by model and by project, sorted desc', () => {
    const records = [
      rec({ model: 'Opus', project: '/a', projectLabel: 'a', input: 100, output: 0 }),
      rec({ model: 'Sonnet', project: '/b', projectLabel: 'b', input: 300, output: 0 }),
      rec({ model: 'Opus', project: '/a', projectLabel: 'a', input: 50, output: 0 })
    ]
    const s = buildSnapshot(records, now)
    expect(s.byModel.map((m) => m.label)).toEqual(['Sonnet', 'Opus'])
    expect(s.byProject[0]).toMatchObject({ label: 'b' })
    expect(s.byProject.find((p) => p.label === 'a')?.totalTokens).toBe(150)
  })

  it('exposes 5-hour and weekly windows in the snapshot', () => {
    const s = buildSnapshot([rec({ ts: now - HOUR })], now)
    expect(s.fiveHour.windowMs).toBe(5 * HOUR)
    expect(s.weekly.windowMs).toBe(7 * DAY)
    expect(s.fiveHour.percentLeft).toBeGreaterThanOrEqual(0)
  })
})

describe('computeWindow', () => {
  const now = Date.parse('2026-06-18T12:00:00.000Z')
  const HOUR = 3_600_000
  const FIVE_H = 5 * HOUR
  const rec = (ts: number, tokens: number): UsageRecord => ({
    id: `${ts}`,
    ts,
    model: 'Opus',
    project: '/p',
    projectLabel: 'p',
    input: tokens,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0
  })

  it('reports % used vs the budget and a real reset time for an active block', () => {
    // input-only ⇒ weighted == raw: 400 + 320 = 720 used; budget 1000 → 72% used.
    const recs = [rec(now - 90 * 60_000, 400), rec(now - HOUR, 320)]
    const w = computeWindow(recs, now, FIVE_H, 1000)
    expect(w.used).toBe(720)
    expect(w.limit).toBe(1000)
    expect(w.percentUsed).toBe(72)
    expect(w.percentLeft).toBe(28)
    expect(w.resetAt).not.toBeNull()
    // resets at the first message's timestamp + 5h (minute-precise, not floored)
    expect(w.resetAt).toBe(now - 90 * 60_000 + FIVE_H)
  })

  it('weights tokens by cost (output 5×, cache-read 0.1×) not raw counts', () => {
    // One record: 100 input + 100 output + 1000 cache-read.
    const r: UsageRecord = {
      id: 'x',
      ts: now - HOUR,
      model: 'Opus',
      project: '/p',
      projectLabel: 'p',
      input: 100,
      output: 100,
      cacheCreate: 0,
      cacheRead: 1000
    }
    // weighted = 100*1 + 100*5 + 1000*0.1 = 700 (raw would be 1200).
    const w = computeWindow([r], now, FIVE_H, 7000)
    expect(w.used).toBe(700)
    expect(w.percentUsed).toBe(10)
  })

  it('is idle (100% left, no reset) when the last activity is older than the window', () => {
    const w = computeWindow([rec(now - 6 * HOUR, 999)], now, FIVE_H, 1000)
    expect(w.used).toBe(0)
    expect(w.percentLeft).toBe(100)
    expect(w.resetAt).toBeNull()
  })

  it('uses the provided plan budget as the limit (no busiest-block guessing)', () => {
    const w = computeWindow([rec(now - 30 * 60_000, 500)], now, FIVE_H, 2000)
    expect(w.used).toBe(500)
    expect(w.limit).toBe(2000)
    expect(w.percentUsed).toBe(25)
    expect(w.percentLeft).toBe(75)
  })

  it('returns full headroom for no records', () => {
    const w = computeWindow([], now, FIVE_H, 1000)
    expect(w.used).toBe(0)
    expect(w.percentLeft).toBe(100)
    expect(w.resetAt).toBeNull()
  })
})
