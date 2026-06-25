import { homedir } from 'node:os'
import { join } from 'node:path'
import { readdir, stat, open } from 'node:fs/promises'
import { getSettings } from './settingsService'
import { parseUserPrompt, buildHistory, type PromptRec } from './sessionHistoryParse'
import type { SessionHistory } from '@shared/types'

/**
 * Session-history (checkpoint) navigator data. The hard part is binding the rail
 * to the Claude session running in ONE specific terminal — a project can have many
 * sessions (and the meta-session that's always being written would otherwise always
 * "win"). So we identify the terminal's session by FINGERPRINT: the renderer sends
 * recent distinctive lines from that terminal's buffer, and we pick the transcript
 * whose conversation text contains them. A fresh / non-Claude terminal matches
 * nothing → empty rail. Read-only throughout.
 */

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const TAIL_BYTES = 512 * 1024 // how much of each transcript's tail to fingerprint
const MAX_PROMPTS = 5000
const MAX_READ_BYTES = 64 * 1024 * 1024
const MIN_HITS = 2 // sample lines that must appear for a confident session match

interface Sess {
  sessionId: string
  cwd: string
  lastTs: number
  recs: PromptRec[]
  offset: number
}

const byFile = new Map<string, Sess>() // transcript path → loaded session (cached)
const leafBind = new Map<string, string>() // pane leafId → its currently bound transcript

const norm = (p: string): string => p.replace(/[\\/]+$/, '')
const enabled = (): boolean => getSettings().sessionHistory.enabled
const slugFor = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

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

/** The parsed conversation TEXT (assistant/user message text) of a transcript's
 * tail, lowercased — for fingerprint matching against terminal lines. */
async function textTail(path: string): Promise<string> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return ''
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
  return out.join('\n').toLowerCase()
}

function needlesFrom(sample: string[]): string[] {
  return sample.map((s) => s.toLowerCase().slice(0, 80)).filter((s) => s.length >= 18)
}
function countHits(blob: string, needles: string[]): number {
  let n = 0
  for (const x of needles) if (blob.includes(x)) n++
  return n
}

/** Newest-first transcript paths for a project. */
async function candidates(cwd: string): Promise<string[]> {
  const dir = join(PROJECTS_DIR, slugFor(cwd))
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
  if (hint && countHits(await textTail(hint), needles) >= MIN_HITS) return hint
  let best: string | null = null
  let bestHits = MIN_HITS - 1
  for (const path of (await candidates(nc)).slice(0, 8)) {
    const hits = countHits(await textTail(path), needles)
    if (hits > bestHits) {
      bestHits = hits
      best = path
    }
    if (bestHits >= 3) break // strong match (newest wins ties via order)
  }
  return best
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
  for (const line of text.split('\n')) {
    const r = parseUserPrompt(line)
    if (r) {
      sess.sessionId = r.sessionId || sess.sessionId
      pushPrompt(sess, r)
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
  const lastNl = text.lastIndexOf('\n')
  if (lastNl < 0) return
  const complete = text.slice(0, lastNl)
  sess.offset += Buffer.byteLength(complete, 'utf8') + 1
  for (const line of complete.split('\n')) {
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
  const hint = leafBind.get(leafId) ?? null
  const positive = await bestMatch(nc, sample, hint)
  if (positive) leafBind.set(leafId, positive)
  else if (!claudeActive) leafBind.delete(leafId)
  const path = leafBind.get(leafId)
  if (!path) return emptyHistory(nc)
  let sess = byFile.get(path)
  if (!sess) sess = (await fullLoad(path)) ?? undefined
  else await tailSession(path, sess)
  return sess ? buildHistory(sess.sessionId, nc, sess.recs) : emptyHistory(nc)
}

// The rail polls getSessionHistory directly, so no background watcher is needed.
export function startSessionHistoryWatcher(): void {}
export function stopSessionHistoryWatcher(): void {}
