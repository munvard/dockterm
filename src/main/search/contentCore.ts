import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { buildMatcher, hasBinaryExtension, looksBinary, searchText } from '@shared/search/lineSearch'
import {
  CONTENT_CAPS,
  SHARED,
  type AckMsg,
  type ContentFileResult,
  type ContentOptions,
  type FeedMsg,
  type MessagePortLike
} from './protocol'

const READ_CONCURRENCY = 6
const FLUSH_MS = 80
const FLUSH_FILES = 30
const MAX_OUTSTANDING = 4
const FEED_CHUNK = 200

export type ScanOutcome =
  | { kind: 'none' }
  | { kind: 'skip'; reason: 'binary' | 'large' | 'error' }
  | { kind: 'match'; file: ContentFileResult }

/** Read one file and search it. The file comes from the index (symlinks were never indexed). */
export async function scanFile(root: string, rel: string, re: RegExp, maxPerFile: number): Promise<ScanOutcome> {
  if (hasBinaryExtension(rel)) return { kind: 'skip', reason: 'binary' }
  const abs = join(root, rel)
  let handle: import('node:fs/promises').FileHandle | null = null
  try {
    const before = await fs.lstat(abs)
    if (!before.isFile()) return { kind: 'none' }
    handle = await fs.open(abs, 'r')
    const st = await handle.stat()
    // The file was swapped for something else between lstat and open: skip it.
    if (st.ino !== before.ino || st.dev !== before.dev || !st.isFile()) return { kind: 'none' }
    if (st.size > CONTENT_CAPS.MAX_FILE_BYTES) return { kind: 'skip', reason: 'large' }
    if (st.size === 0) return { kind: 'none' }
    const buf = Buffer.allocUnsafe(st.size)
    let read = 0
    while (read < st.size) {
      const { bytesRead } = await handle.read(buf, read, st.size - read, read)
      if (bytesRead === 0) break
      read += bytesRead
    }
    const bytes = read === st.size ? buf : buf.subarray(0, read)
    if (looksBinary(bytes)) return { kind: 'skip', reason: 'binary' }
    const text = bytes.toString('utf8')
    const res = searchText(text, re, maxPerFile)
    if (res.totalLines === 0) return { kind: 'none' }
    return { kind: 'match', file: { relPath: rel, matches: res.matches, totalLines: res.totalLines } }
  } catch {
    return { kind: 'skip', reason: 'error' }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

export interface ScannerSink {
  progress(files: ContentFileResult[], scanned: number): void
}

/** Scans chunks of files, keeps the shared counters, batches results out. Used by the search worker. */
export class ContentScanner {
  private pending: ContentFileResult[] = []
  private lastFlush = Date.now()
  private scannedLocal = 0

  constructor(
    private readonly root: string,
    private readonly re: RegExp,
    private readonly shared: Int32Array,
    private readonly sink: ScannerSink
  ) {}

  private canceled(): boolean {
    return Atomics.load(this.shared, SHARED.CANCEL) === 1
  }

  async scanChunk(files: string[]): Promise<void> {
    let next = 0
    const lanes: Promise<void>[] = []
    const lane = async (): Promise<void> => {
      for (;;) {
        if (this.canceled()) return
        const i = next++
        if (i >= files.length) return
        const out = await scanFile(this.root, files[i], this.re, CONTENT_CAPS.MAX_LINES_PER_FILE)
        this.record(out)
        // Let queued port messages (cancel, next chunk) run between files.
        if ((i & 7) === 7) await new Promise<void>((r) => setImmediate(r))
      }
    }
    for (let k = 0; k < READ_CONCURRENCY; k++) lanes.push(lane())
    await Promise.all(lanes)
    this.flush(false)
  }

  private record(out: ScanOutcome): void {
    Atomics.add(this.shared, SHARED.SCANNED, 1)
    this.scannedLocal++
    if (out.kind === 'skip') {
      if (out.reason === 'large') Atomics.add(this.shared, SHARED.SKIPPED_LARGE, 1)
      else if (out.reason === 'binary') Atomics.add(this.shared, SHARED.SKIPPED_BINARY, 1)
      else Atomics.add(this.shared, SHARED.ERRORS, 1)
    } else if (out.kind === 'match') {
      const f = out.file
      Atomics.add(this.shared, SHARED.TOTAL_LINES, f.totalLines)
      Atomics.add(this.shared, SHARED.FILES_WITH_MATCH, 1)
      const room = Math.max(0, CONTENT_CAPS.MAX_STORED_LINES - Atomics.load(this.shared, SHARED.STORED))
      const keep = Math.min(f.matches.length, room)
      if (keep > 0) {
        Atomics.add(this.shared, SHARED.STORED, keep)
        this.pending.push(keep === f.matches.length ? f : { ...f, matches: f.matches.slice(0, keep) })
      }
    }
    this.flush(true)
  }

  flush(throttled: boolean): void {
    const now = Date.now()
    if (throttled && this.pending.length < FLUSH_FILES && now - this.lastFlush < FLUSH_MS) return
    if (this.pending.length === 0 && throttled) return
    this.sink.progress(this.pending, this.scannedLocal)
    this.pending = []
    this.scannedLocal = 0
    this.lastFlush = now
  }
}

/** Build the matcher or explain why not (shared by the worker and by tests). */
export function matcherFor(opts: ContentOptions): { re: RegExp } | { error: string } {
  const m = buildMatcher(opts)
  return m.ok ? { re: m.re } : { error: m.error }
}

/** Feeder side of a port: hands out chunks with a small credit window so memory stays bounded. */
export class PortSink {
  private outstanding = 0
  private waiter: (() => void) | null = null

  constructor(private readonly port: MessagePortLike) {
    port.on('message', (m: unknown) => {
      if ((m as AckMsg | undefined)?.ack) {
        this.outstanding = Math.max(0, this.outstanding - 1)
        const w = this.waiter
        this.waiter = null
        w?.()
      }
    })
  }

  hasCapacity(): boolean {
    return this.outstanding < MAX_OUTSTANDING
  }

  whenCapacity(): Promise<void> {
    if (this.hasCapacity()) return Promise.resolve()
    return new Promise<void>((r) => {
      this.waiter = r
    })
  }

  send(files: string[]): void {
    this.outstanding++
    this.port.postMessage({ files } satisfies FeedMsg)
  }

  end(): void {
    this.port.postMessage({ end: true } satisfies FeedMsg)
  }
}

/**
 * Stream `candidates` to the scanners in small chunks, always to a sink that has
 * room. Resolves when everything is handed out (or the search was canceled).
 */
export async function feedContent(
  candidates: string[],
  sinks: PortSink[],
  shared: Int32Array
): Promise<void> {
  let rr = 0
  for (let i = 0; i < candidates.length; i += FEED_CHUNK) {
    if (Atomics.load(shared, SHARED.CANCEL) === 1) break
    let sink: PortSink | undefined
    for (let k = 0; k < sinks.length; k++) {
      const s = sinks[(rr + k) % sinks.length]
      if (s.hasCapacity()) {
        sink = s
        rr = (rr + k + 1) % sinks.length
        break
      }
    }
    if (!sink) {
      // Every scanner is busy: wait for whichever frees first.
      await Promise.race(sinks.map((s) => s.whenCapacity()))
      i -= FEED_CHUNK
      continue
    }
    sink.send(candidates.slice(i, i + FEED_CHUNK))
  }
  for (const s of sinks) s.end()
}
