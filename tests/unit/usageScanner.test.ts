import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UsageScanner } from '@main/services/usageScanner'
import { PLAN } from '@main/services/usageCore'

const rec = (id: string, out: number): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    cwd: '/p/proj',
    requestId: 'r' + id,
    message: { id: 'm' + id, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: out } }
  })

describe('UsageScanner (F5: runs in the worker thread, same class in-process)', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('reads transcripts, tails appended lines, de-dupes, and builds a snapshot', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dockterm-scan-'))
    mkdirSync(join(dir, 'slug'))
    const file = join(dir, 'slug', 's.jsonl')
    writeFileSync(file, rec('1', 5) + '\n' + rec('1', 5) + '\n')
    const sc = new UsageScanner(dir)
    expect(await sc.scan()).toBe(true)
    expect(sc.snapshot(Date.now(), PLAN.max5x).allTime.outputTokens).toBe(5)
    expect(await sc.scan()).toBe(false) // nothing new
    appendFileSync(file, rec('2', 7) + '\n')
    expect(await sc.scan()).toBe(true)
    expect(sc.snapshot(Date.now(), PLAN.max5x).allTime.outputTokens).toBe(12)
  })

  it('an empty or missing projects dir is an empty snapshot', async () => {
    dir = mkdtempSync(join(tmpdir(), 'dockterm-scan-'))
    const sc = new UsageScanner(join(dir, 'nope'))
    expect(await sc.scan()).toBe(false)
    expect(sc.snapshot(Date.now(), PLAN.pro).empty).toBe(true)
  })
})
