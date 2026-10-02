import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { ContentScanner, PortSink, feedContent, matcherFor, scanFile } from '../../../src/main/search/contentCore'
import { CONTENT_CAPS, SHARED, type ContentFileResult } from '../../../src/main/search/protocol'

let root = ''
const put = (rel: string, data: string | Buffer): void => {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, data)
}
const re = (query: string, extra: object = {}): RegExp => {
  const m = matcherFor({ query, caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', includeIgnored: false, ...extra })
  if ('error' in m) throw new Error(m.error)
  return m.re
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dockterm-content-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('scanFile', () => {
  it('finds a match with line and ranges', async () => {
    put('a.ts', 'one\ntwo NEEDLE here\n')
    const out = await scanFile(root, 'a.ts', re('needle'), 100)
    expect(out.kind).toBe('match')
    if (out.kind === 'match') {
      expect(out.file.matches[0].line).toBe(2)
      expect(out.file.matches[0].ranges).toEqual([[4, 10]])
    }
  })
  it('skips binary content and binary extensions', async () => {
    put('bin.dat', Buffer.from([110, 101, 101, 100, 108, 101, 0, 1, 2]))
    put('img.png', 'needle')
    expect(await scanFile(root, 'bin.dat', re('needle'), 100)).toEqual({ kind: 'skip', reason: 'binary' })
    expect(await scanFile(root, 'img.png', re('needle'), 100)).toEqual({ kind: 'skip', reason: 'binary' })
  })
  it('skips files over the size cap', async () => {
    put('big.txt', Buffer.alloc(CONTENT_CAPS.MAX_FILE_BYTES + 10, 97))
    expect(await scanFile(root, 'big.txt', re('a'), 100)).toEqual({ kind: 'skip', reason: 'large' })
  })
  it('never reads through a symlink', async () => {
    put('real.txt', 'needle')
    symlinkSync(join(root, 'real.txt'), join(root, 'link.txt'))
    expect((await scanFile(root, 'link.txt', re('needle'), 100)).kind).toBe('none')
    expect((await scanFile(root, 'real.txt', re('needle'), 100)).kind).toBe('match')
  })
  it('a missing file is an error skip, not a throw', async () => {
    expect(await scanFile(root, 'gone.txt', re('a'), 100)).toEqual({ kind: 'skip', reason: 'error' })
  })
})

describe('ContentScanner', () => {
  it('counts, caps stored lines and reports progress', async () => {
    for (let i = 0; i < 20; i++) put(`f${i}.txt`, 'needle\n'.repeat(5))
    put('none.txt', 'nothing')
    const shared = new Int32Array(new SharedArrayBuffer(SHARED.LENGTH * 4))
    const got: ContentFileResult[] = []
    const sc = new ContentScanner(root, re('needle'), shared, { progress: (f) => got.push(...f) })
    await sc.scanChunk([...Array.from({ length: 20 }, (_, i) => `f${i}.txt`), 'none.txt'])
    expect(Atomics.load(shared, SHARED.SCANNED)).toBe(21)
    expect(Atomics.load(shared, SHARED.FILES_WITH_MATCH)).toBe(20)
    expect(Atomics.load(shared, SHARED.TOTAL_LINES)).toBe(100)
    expect(got.length).toBe(20)
  })
  it('stops when canceled', async () => {
    for (let i = 0; i < 50; i++) put(`f${i}.txt`, 'needle')
    const shared = new Int32Array(new SharedArrayBuffer(SHARED.LENGTH * 4))
    Atomics.store(shared, SHARED.CANCEL, 1)
    const sc = new ContentScanner(root, re('needle'), shared, { progress: () => undefined })
    await sc.scanChunk(Array.from({ length: 50 }, (_, i) => `f${i}.txt`))
    expect(Atomics.load(shared, SHARED.SCANNED)).toBe(0)
  })
  it('stops storing lines past the global cap but keeps counting', async () => {
    const shared = new Int32Array(new SharedArrayBuffer(SHARED.LENGTH * 4))
    Atomics.store(shared, SHARED.STORED, CONTENT_CAPS.MAX_STORED_LINES)
    put('a.txt', 'needle\nneedle')
    const got: ContentFileResult[] = []
    const sc = new ContentScanner(root, re('needle'), shared, { progress: (f) => got.push(...f) })
    await sc.scanChunk(['a.txt'])
    expect(got).toHaveLength(0)
    expect(Atomics.load(shared, SHARED.TOTAL_LINES)).toBe(2)
  })
})

describe('matcherFor', () => {
  it('reports an invalid regex', () => {
    const m = matcherFor({ query: '(', caseSensitive: false, wholeWord: false, regex: true, include: '', exclude: '', includeIgnored: false })
    expect('error' in m).toBe(true)
  })
})

describe('feedContent with credits', () => {
  it('hands every file to the scanners once, never more than the credit window ahead', async () => {
    const files = Array.from({ length: 2000 }, (_, i) => `f${i}`)
    const a = new MessageChannel()
    const b = new MessageChannel()
    const seen: string[] = []
    let maxInFlight = 0
    let inFlight = 0
    let ended = 0
    const consume = (port: MessagePort): void => {
      port.on('message', (m: { files?: string[]; end?: true }) => {
        if (m.end) {
          ended++
          return
        }
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        seen.push(...(m.files ?? []))
        setTimeout(() => {
          inFlight--
          port.postMessage({ ack: true })
        }, 1)
      })
    }
    consume(a.port2 as never)
    consume(b.port2 as never)
    const shared = new Int32Array(new SharedArrayBuffer(SHARED.LENGTH * 4))
    await feedContent(files, [new PortSink(a.port1 as never), new PortSink(b.port1 as never)], shared)
    await new Promise((r) => setTimeout(r, 50))
    expect(new Set(seen).size).toBe(2000)
    expect(seen).toHaveLength(2000)
    expect(ended).toBe(2)
    expect(maxInFlight).toBeLessThanOrEqual(8)
    a.port1.close()
    b.port1.close()
  })
})
