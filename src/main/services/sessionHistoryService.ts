import { join } from 'node:path'
import { readdir, stat, open } from 'node:fs/promises'
import { getSettings } from './settingsService'
import { claudeConfigDir } from './claudeConfigDir'
import { slugFor, isDirectChild, pickProjectDir, stripTuiPrefix, pickByHits } from './transcriptPaths'
import { parseUserPrompt, buildHistory, type PromptRec } from './sessionHistoryParse'
import {
  appendConversation,
  linesByChars,
  newConversationParseState,
  sliceCompleteLines,
  parseTailSlice,
  type ConversationParseState
} from './readingParse'
import type { SessionHistory, ReadingConversation, ReadingMessage } from '@shared/types'

/**
 * Session-history (checkpoint) navigator data. The hard part is binding the rail
 * to the Claude session running in ONE specific terminal — a project can have many
 * sessions (and the meta-session that's always being written would otherwise always
 * "win"). So we identify the terminal's session by FINGERPRINT: the renderer sends
 * recent distinctive lines from that terminal's buffer, and we pick the transcript
 * whose conversation text contains them. A fresh / non-Claude terminal matches
 * nothing → empty rail. Read-only throughout.
 */

const PROJECTS_DIR = join(claudeConfigDir(), 'projects')
const TAIL_BYTES = 512 * 1024 // how much of each transcript's tail to fingerprint
const MAX_PROMPTS = 5000
// First sight of a transcript reads + JSON-parses this many trailing bytes
// synchronously. This used to be 64MB — enough that a long-lived project's cold
// parse could visibly stall the main process (which also routes every window's
// IPC and pty output) for multiple seconds. Both surfaces only need recent
// context anyway (getConversation trims to MAX_CONV_MESSAGES regardless).
const MAX_READ_BYTES = 16 * 1024 * 1024
const MIN_HITS = 2 // sample lines that must appear for a confident session match
const MAX_CONV_MESSAGES = 2000 // bound a cached conversation (trimmed from the front)

// Bound how many distinct transcripts / panes stay cached. Without this, byFile,
// convByFile, and leafBind only ever grow — one entry per transcript ever opened,
// one per pane leafId ever created — for the lifetime of the app. There's no
// explicit "pane closed" signal reaching this service, so eviction is by
// recency: FILE_CACHE / LEAF_CACHE are plain Maps used as LRU caches (touch()
// moves a key to the most-recently-used end; a closed pane or a transcript no
// surface polls anymore simply stops being touched and ages out).
const FILE_CACHE_MAX = 150
const LEAF_CACHE_MAX = 300

interface Sess {
  sessionId: string
  cwd: string
  lastTs: number
  recs: PromptRec[]
  offset: number
}

const byFile = new Map<string, Sess>() // transcript path → loaded session (cached)
const leafBind = new Map<string, string>() // pane leafId → its currently bound transcript
const fileLru = new Map<string, true>() // path → presence, in LRU order (byFile/convByFile/tailCache)
const leafLru = new Map<string, true>() // leafId → presence, in LRU order (leafBind)

/** Move `key` to the most-recently-used end of a Map used as an LRU cache (a
 * plain Map iterates in insertion order; re-setting an EXISTING key keeps its
 * original position, so this deletes first to actually move it). */
function touch<K>(order: Map<K, true>, key: K): void {
  order.delete(key)
  order.set(key, true)
}

/** Drop the least-recently-used keys (the front of insertion order) once an LRU
 * order map grows past `max`, running `onDrop` for each evicted key. */
function evict<K>(order: Map<K, true>, max: number, onDrop: (key: K) => void): void {
  while (order.size > max) {
    const oldest = order.keys().next().value
    if (oldest === undefined) break
    order.delete(oldest)
    onDrop(oldest)
  }
}

function touchLeaf(leafId: string): void {
  touch(leafLru, leafId)
  evict(leafLru, LEAF_CACHE_MAX, (id) => leafBind.delete(id))
}

function setLeafBind(leafId: string, path: string): void {
  leafBind.set(leafId, path)
  touchLeaf(leafId)
}

function touchFilePath(path: string): void {
  touch(fileLru, path)
  evict(fileLru, FILE_CACHE_MAX, (p) => {
    byFile.delete(p)
    convByFile.delete(p)
    tailCache.delete(p)
  })
}

/** Parsed conversations per transcript, grown by reading only appended bytes —
 * chat mode polls at 700ms, so re-reading the whole tail each time is too costly.
 * `state` carries the parse across chunk boundaries (tool pairing, dedup, ids).
 * `revision` increments only when something was actually parsed, so a poll that
 * found nothing new can tell the caller "unchanged" instead of resending the
 * whole (possibly 2000-message) list. */
interface ConvCache {
  messages: ReadingMessage[]
  offset: number
  state: ConversationParseState
  revision: number
}
const convByFile = new Map<string, ConvCache>()

/** Revisions are unique across ALL transcripts, not per file. A caller that
 * switches from session A to session B in the same pane (`/resume`, a fresh
 * `claude`) sends A's last revision as `sinceRevision`; with per-file counters
 * B's first parse could also be 1 and be answered `unchanged`, leaving A's chat
 * on screen. */
let revisionCounter = 0
const nextRevision = (): number => ++revisionCounter

/** Bound a long-running conversation: drop the OLDEST messages, then forget any
 * pending tool whose row is no longer retained (its result can never render). */
function trimConversation(cache: ConvCache): void {
  if (cache.messages.length <= MAX_CONV_MESSAGES) return
  cache.messages.splice(0, cache.messages.length - MAX_CONV_MESSAGES)
  const live = new Set<ReadingMessage>(cache.messages)
  for (const [id, msg] of cache.state.pendingTools) {
    if (!live.has(msg)) cache.state.pendingTools.delete(id)
  }
}

const norm = (p: string): string => p.replace(/[\\/]+$/, '')
const enabled = (): boolean => getSettings().sessionHistory.enabled

// Two surfaces (the docked Reading panel and a pane's Chat mode) can be bound to
// the SAME transcript and poll independently, and getSessionHistory/
// getConversation both read+mutate the SAME per-path cache — two concurrent
// calls for one path used to both read the pre-mutation offset, both parse the
// same appended bytes (duplicate messages), and both advance the offset (past
// where either read actually reached). Serialize all path-keyed work for a
// given transcript through one promise chain.
const pathChains = new Map<string, Promise<unknown>>()
export function serialize<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = pathChains.get(path) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  pathChains.set(path, run)
  // NOT run.finally(...): that returns a second promise which rejects whenever
  // `fn` throws, and nothing handles it (an unhandled rejection can take the
  // main process down). then(cleanup, cleanup) settles either way.
  const cleanup = (): void => {
    if (pathChains.get(path) === run) pathChains.delete(path)
  }
  void run.then(cleanup, cleanup)
  return run
}

async function readSlice(path: string, start: number, end: number): Promise<string> {
  const len = end - start
  if (len <= 0) return ''
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, start)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

interface TailEntry {
  size: number
  text: string
}
const tailCache = new Map<string, TailEntry>()

/** The parsed conversation TEXT (assistant/user message text) of a transcript's
 * tail, lowercased — for fingerprint matching against terminal lines. Memoized
 * by file SIZE: bestMatch calls this for the bound pane's hint on every single
 * poll (every 700ms in chat mode) even when nothing changed, and without this
 * it re-reads + re-parses up to 512KB every time. */
async function textTail(path: string): Promise<string> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return ''
  }
  const hit = tailCache.get(path)
  if (hit && hit.size === size) {
    touchFilePath(path)
    return hit.text
  }
  let text: string
  try {
    text = await readSlice(path, size > TAIL_BYTES ? size - TAIL_BYTES : 0, size)
  } catch {
    return ''
  }
  const out: string[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s || s[0] !== '{') continue
    let o: { message?: { content?: unknown } }
    try {
      o = JSON.parse(s)
    } catch {
      continue
    }
    const c = o.message?.content
    if (typeof c === 'string') out.push(c)
    else if (Array.isArray(c)) {
      for (const b of c) {
        if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
          const t = (b as { text?: unknown }).text
          if (typeof t === 'string') out.push(t)
        }
      }
    }
  }
  const joined = out.join('\n').toLowerCase()
  tailCache.set(path, { size, text: joined })
  touchFilePath(path)
  return joined
}

function needlesFrom(sample: string[]): string[] {
  return sample.map((s) => stripTuiPrefix(s).toLowerCase().slice(0, 80)).filter((s) => s.length >= 18)
}
function countHits(blob: string, needles: string[]): number {
  let n = 0
  for (const x of needles) if (blob.includes(x)) n++
  return n
}

/** True when `path` is a transcript of the project `cwd` — i.e. it lives in that
 * project's own transcripts directory. A sticky pane binding or a hint must
 * never point at another project's transcript. */
function belongsToProject(path: string, cwd: string): boolean {
  return isDirectChild(path, join(PROJECTS_DIR, slugFor(cwd)), process.platform)
}

/** The pane's bound transcript, but only if it belongs to the requested project
 * (a stale binding from a different cwd is dropped). */
function boundPath(paneKey: string, nc: string): string | undefined {
  const path = leafBind.get(paneKey)
  if (path && !belongsToProject(path, nc)) {
    leafBind.delete(paneKey)
    return undefined
  }
  return path
}

/** Newest-first transcript paths for a project. */
async function candidates(cwd: string): Promise<string[]> {
  // Claude names the folder from the cwd it saw ('D--x'); the pane may report
  // 'd:\x'. On Windows that differs only in case, so look the folder up by name.
  const slug = slugFor(cwd)
  let dir = join(PROJECTS_DIR, slug)
  try {
    const found = pickProjectDir(await readdir(PROJECTS_DIR), slug, process.platform)
    if (found) dir = join(PROJECTS_DIR, found)
  } catch {
    // fall through to the direct path
  }
  let entries: { path: string; mt: number }[]
  try {
    entries = []
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const p = join(dir, f)
      try {
        entries.push({ path: p, mt: (await stat(p)).mtimeMs })
      } catch {
        // skip
      }
    }
  } catch {
    return []
  }
  return entries.sort((a, b) => b.mt - a.mt).map((e) => e.path)
}

/** Positively identify the transcript a terminal is running, via fingerprint —
 * returns a path only on a CONFIDENT match (≥ MIN_HITS), else null. No side
 * effects. `hint` (the currently-bound transcript) is checked first: it's the fast
 * path AND it keeps the binding stable when the visible text still belongs to that
 * same session (e.g. the user scrolled to an older message). */
async function bestMatch(nc: string, sample: string[], hint: string | null): Promise<string | null> {
  const needles = needlesFrom(sample)
  if (needles.length === 0) return null
  if (hint && belongsToProject(hint, nc) && countHits(await textTail(hint), needles) >= MIN_HITS) return hint
  const hits: { path: string; n: number }[] = []
  let top = 0
  for (const path of (await candidates(nc)).slice(0, 8)) {
    const n = countHits(await textTail(path), needles)
    hits.push({ path, n })
    if (n > top) top = n
    if (top >= 3) break // strong match (newest wins ties via order)
  }
  return pickByHits(hits, MIN_HITS)
}

/** About 1 MB of transcript per synchronous parse run; the event loop is free between runs. */
const PARSE_RUN_CHARS = 1_000_000
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

async function appendConversationYielding(
  messages: ReadingMessage[],
  lines: string[],
  state: Parameters<typeof appendConversation>[2]
): Promise<void> {
  const runs = linesByChars(lines, PARSE_RUN_CHARS)
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) await yieldLoop()
    appendConversation(messages, runs[i], state)
  }
}

function pushPrompt(sess: Sess, r: PromptRec): void {
  sess.recs.push(r)
  if (r.cwd) sess.cwd = r.cwd
  if (r.ts > sess.lastTs) sess.lastTs = r.ts
  if (sess.recs.length > MAX_PROMPTS) sess.recs.splice(0, sess.recs.length - MAX_PROMPTS)
}

async function fullLoad(path: string): Promise<Sess | null> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return null
  }
  const start = size > MAX_READ_BYTES ? size - MAX_READ_BYTES : 0
  let text: string
  try {
    text = await readSlice(path, start, size)
  } catch {
    return null
  }
  if (start > 0) {
    const nl = text.indexOf('\n')
    if (nl >= 0) text = text.slice(nl + 1)
  }
  const sess: Sess = { sessionId: '', cwd: '', lastTs: 0, recs: [], offset: size }
  const runs = linesByChars(text.split('\n'), PARSE_RUN_CHARS)
  for (let i = 0; i < runs.length; i++) {
    if (i > 0) await yieldLoop()
    for (const line of runs[i]) {
      const r = parseUserPrompt(line)
      if (r) {
        sess.sessionId = r.sessionId || sess.sessionId
        pushPrompt(sess, r)
      }
    }
  }
  byFile.set(path, sess)
  return sess
}

/** Read appended bytes for new prompts (live updates as you keep chatting). */
async function tailSession(path: string, sess: Sess): Promise<void> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return
  }
  if (size <= sess.offset) return
  let text: string
  try {
    text = await readSlice(path, sess.offset, size)
  } catch {
    return
  }
  const { lines, consumed } = sliceCompleteLines(text)
  if (consumed === 0) return
  sess.offset += consumed
  for (const line of lines) {
    const r = parseUserPrompt(line)
    if (r) {
      sess.sessionId = r.sessionId || sess.sessionId
      pushPrompt(sess, r)
    }
  }
}

const emptyHistory = (cwd: string): SessionHistory => ({ sessionId: '', cwd, prompts: [] })

/**
 * Checkpoints for the session running in pane `leafId` (which produced `sample`).
 * `leafId` here is the pane KEY main built from the sender's window id plus the
 * renderer's leafId (windowNamespace.paneKey), so panes of different windows
 * never share a binding.
 *
 * The binding is STICKY so scrolling can't blank the rail: a positive fingerprint
 * match (re)binds the pane to that transcript; with no positive match we KEEP the
 * existing binding as long as Claude is still running in the pane (`claudeActive` —
 * the alternate screen is up but the user scrolled to the header / old output that
 * doesn't fingerprint). Only when Claude is gone (back to a normal shell) and
 * nothing matches do we drop the binding → empty rail.
 */
export async function getSessionHistory(
  cwd: string,
  sample: string[],
  leafId: string,
  claudeActive: boolean
): Promise<SessionHistory> {
  if (!enabled()) return emptyHistory(cwd)
  const nc = norm(cwd)
  touchLeaf(leafId)
  const hint = boundPath(leafId, nc) ?? null
  const positive = await bestMatch(nc, sample, hint)
  if (positive) setLeafBind(leafId, positive)
  else if (!claudeActive) leafBind.delete(leafId)
  const path = boundPath(leafId, nc)
  if (!path) return emptyHistory(nc)
  touchFilePath(path)
  return serialize(path, async () => {
    let sess = byFile.get(path)
    if (!sess) sess = (await fullLoad(path)) ?? undefined
    else await tailSession(path, sess)
    return sess ? buildHistory(sess.sessionId, nc, sess.recs) : emptyHistory(nc)
  })
}

const emptyConversation = (cwd: string): ReadingConversation => ({
  sessionId: '',
  cwd,
  messages: [],
  revision: 0
})

/**
 * The rendered conversation for the session running in pane `leafId`. Same sticky
 * binding as getSessionHistory (fingerprint match rebinds; kept while claudeActive;
 * dropped when Claude is gone and nothing matches), but parses FULL content into
 * ReadingMessage[] rather than just user prompts. Reads incrementally — a full
 * parse on first sight, then only appended bytes.
 *
 * `sinceRevision`, when it matches the transcript's current revision, short-
 * circuits to `{ unchanged: true, messages: [] }` instead of resending a
 * conversation that can be thousands of messages long on every poll (chat mode
 * polls every 700ms) — the caller keeps its existing `messages` in that case.
 *
 * NOTE: deliberately NOT gated on `enabled()`. That setting is "show the
 * checkpoints rail"; the Reading panel and chat mode are separate surfaces and
 * must not go silently blank when the rail is turned off.
 */
export async function getConversation(
  cwd: string,
  sample: string[],
  leafId: string,
  claudeActive: boolean,
  sinceRevision?: number
): Promise<ReadingConversation> {
  const nc = norm(cwd)
  touchLeaf(leafId)
  const hint = boundPath(leafId, nc) ?? null
  const positive = await bestMatch(nc, sample, hint)
  if (positive) setLeafBind(leafId, positive)
  else if (!claudeActive) leafBind.delete(leafId)
  const path = boundPath(leafId, nc)
  if (!path) return emptyConversation(nc)
  touchFilePath(path)

  return serialize(path, async () => {
    const respond = (messages: ReadingMessage[], revision: number): ReadingConversation => {
      const sessionId = byFile.get(path)?.sessionId ?? ''
      if (sinceRevision !== undefined && sinceRevision === revision) {
        return { sessionId, cwd: nc, messages: [], revision, unchanged: true }
      }
      return { sessionId, cwd: nc, messages, revision }
    }

    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      // A transient stat failure must NOT blank a live conversation (it would
      // flash chat mode's "isn't running Claude" empty state) — fall back to cache.
      const c = convByFile.get(path)
      return c ? respond(c.messages, c.revision) : respond([], 0)
    }

    let cache = convByFile.get(path)
    // Truncated / rotated (or first sight) → full parse of the capped tail.
    if (!cache || size < cache.offset) {
      const start = size > MAX_READ_BYTES ? size - MAX_READ_BYTES : 0
      let text: string
      try {
        text = await readSlice(path, start, size)
      } catch {
        return cache ? respond(cache.messages, cache.revision) : respond([], 0)
      }
      const { lines, end } = parseTailSlice(text, start)
      cache = { messages: [], offset: end, state: newConversationParseState(), revision: nextRevision() }
      await appendConversationYielding(cache.messages, lines, cache.state)
      trimConversation(cache)
      convByFile.set(path, cache)
    } else if (size > cache.offset) {
      // Grown → parse only what was appended, carrying the parse state forward so a
      // tool_result here still resolves the tool_use from an earlier chunk.
      let text: string
      try {
        text = await readSlice(path, cache.offset, size)
      } catch {
        return respond(cache.messages, cache.revision)
      }
      const { lines, consumed } = sliceCompleteLines(text)
      if (consumed > 0) {
        await appendConversationYielding(cache.messages, lines, cache.state)
        trimConversation(cache)
        cache.offset += consumed
        cache.revision = nextRevision()
      }
    }

    return respond(cache.messages, cache.revision)
  })
}

// The rail polls getSessionHistory directly, so no background watcher is needed.
export function startSessionHistoryWatcher(): void {}
export function stopSessionHistoryWatcher(): void {}
