import { constants as fsConstants, promises as fs } from 'node:fs'
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

/** Files in flight per worker. Measured: more in flight hides open latency (Windows, network disks); past ~24 the OS is the limit. */
const READ_CONCURRENCY = 24
const FIRST_CHUNK = 64 * 1024
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const FLUSH_MS = 80
const FLUSH_FILES = 30
const MAX_OUTSTANDING = 4
const FEED_CHUNK = 400

export type ScanOutcome =
  | { kind: 'none' }
  | { kind: 'skip'; reason: 'binary' | 'large' | 'error' }
  | { kind: 'match'; file: ContentFileResult }

/**
 * Read one file and search it. The file comes from the index (symlinks were never indexed).
 * The first 64 KB is read without a stat call, so a small file costs open, read, close. Only a
 * bigger file is stat'ed, to enforce the size cap before the rest is read. `literal` is a
 * case-sensitive plain needle: when the raw bytes do not contain it, no text is decoded at all.
 */
export async function scanFile(
  root: string,
  rel: string,
  re: RegExp,
  maxPerFile: number,
  scratch?: Buffer,
  literal?: Buffer
): Promise<ScanOutcome> {
  if (hasBinaryExtension(rel)) return { kind: 'skip', reason: 'binary' }
  const abs = join(root, rel)
  let handle: import('node:fs/promises').FileHandle | null = null
  try {
    // O_NOFOLLOW refuses a symlink in one syscall (the index never holds symlinks, but a
    // file can be swapped for one after indexing); Windows has no such flag, so lstat first.
    let before: import('node:fs').Stats | null = null
    if (NOFOLLOW === 0) {
      before = await fs.lstat(abs)
      if (!before.isFile()) return { kind: 'none' }
    }
    handle = await fs.open(abs, fsConstants.O_RDONLY | NOFOLLOW)
    const first = scratch && scratch.length >= FIRST_CHUNK ? scratch : Buffer.allocUnsafe(FIRST_CHUNK)
    let got = 0
    while (got < FIRST_CHUNK) {
      const { bytesRead } = await handle.read(first, got, FIRST_CHUNK - got, got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    if (got === 0) return { kind: 'none' }
    if (looksBinary(first.subarray(0, got))) return { kind: 'skip', reason: 'binary' }
    let bytes: Buffer = first.subarray(0, got)
    if (got === FIRST_CHUNK) {
      const st = await handle.stat()
      if (!st.isFile() || (before && (st.ino !== before.ino || st.dev !== before.dev))) return { kind: 'none' }
      if (st.size > CONTENT_CAPS.MAX_FILE_BYTES) return { kind: 'skip', reason: 'large' }
      if (st.size > got) {
        const all = Buffer.allocUnsafe(st.size)
        first.copy(all, 0, 0, got)
        let read = got
        while (read < st.size) {
          const { bytesRead } = await handle.read(all, read, st.size - read, read)
          if (bytesRead === 0) break
          read += bytesRead
        }
        bytes = read === st.size ? all : all.subarray(0, read)
        if (looksBinary(bytes)) return { kind: 'skip', reason: 'binary' }
      }
    } else if (before) {
      const st = await handle.stat()
      if (!st.isFile() || st.ino !== before.ino || st.dev !== before.dev) return { kind: 'none' }
    }
    if (literal && bytes.indexOf(literal) < 0) return { kind: 'none' }
    const res = searchText(bytes.toString('utf8'), re, maxPerFile)
    if (res.totalLines === 0) return { kind: 'none' }
    return { kind: 'match', file: { relPath: rel, matches: res.matches, totalLines: res.totalLines } }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') return { kind: 'none' }
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
    private readonly literal: Buffer | undefined,
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
      const scratch = Buffer.allocUnsafe(FIRST_CHUNK)
      for (;;) {
        if (this.canceled()) return
        const i = next++
        if (i >= files.length) return
        const out = await scanFile(this.root, files[i], this.re, CONTENT_CAPS.MAX_LINES_PER_FILE, scratch, this.literal)
        this.record(out)
        // Let queued port messages (cancel, next chunk) run between files.
        if ((i & 31) === 31) await new Promise<void>((r) => setImmediate(r))
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
export function matcherFor(opts: ContentOptions): { re: RegExp; literal?: Buffer } | { error: string } {
  const m = buildMatcher(opts)
  if (!m.ok) return { error: m.error }
  // Plain, case-sensitive text can be rejected on the raw bytes before any decoding.
  const literal = !opts.regex && opts.caseSensitive && opts.query.length > 0 ? Buffer.from(opts.query, 'utf8') : undefined
  return { re: m.re, literal }
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
