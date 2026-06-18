import { describe, it, expect } from 'vitest'
import { parseUsageLine, buildSnapshot, prettyModel, type UsageRecord } from '@main/services/usageService'

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
})
