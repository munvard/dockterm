import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { readdir, stat, open } from 'node:fs/promises'
import { getSettings } from './settingsService'
import type { UsageSnapshot, UsageTotals, UsageBucket, UsageWindow } from '@shared/types'

/**
 * Live, tokens-only view of local Claude Code usage.
 *
 * Claude Code writes a full JSONL transcript per session under
 * `~/.claude/projects/<slug>/*.jsonl`. Every assistant line carries
 * `message.usage` (input / output / cache-create / cache-read tokens), the
 * model, a timestamp, and the project `cwd`. Because DockTerm runs Claude in its
 * own terminals these files grow live, so we tail the appended bytes on a short
 * interval, keep a rolling set of lightweight records, and broadcast an
 * aggregated snapshot to the renderer. Read-only; only token counts are read,
 * never message content.
 */

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const WINDOW_DAYS = 30
const KEEP_DAYS = 35
const DAY_MS = 86_400_000
const POLL_MS = 5_000

export interface UsageRecord {
  /** `${message.id}:${requestId}` — for de-duping a line seen across scans. */
  id: string
  ts: number
  model: string
  /** project key (the real cwd path), or 'unknown'. */
  project: string
  projectLabel: string
  input: number
  output: number
  cacheCreate: number
  cacheRead: number
}

interface RawLine {
  type?: string
  timestamp?: string
  cwd?: string
  requestId?: string
  message?: {
    id?: string
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
  }
}

function num(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Friendly model bucket (groups versions): Opus / Sonnet / Haiku / other. */
export function prettyModel(id: string): string {
  const m = id.toLowerCase()
  if (m.includes('opus')) return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('haiku')) return 'Haiku'
  return id.replace(/^claude-/, '') || 'unknown'
}

/** Parse one JSONL line into a usage record, or null if it isn't an assistant
 * message carrying token usage. Pure (no I/O) so it's unit-testable. */
export function parseUsageLine(line: string): UsageRecord | null {
  const s = line.trim()
  if (!s) return null
  let o: RawLine
  try {
    o = JSON.parse(s) as RawLine
  } catch {
    return null
  }
  if (!o || o.type !== 'assistant') return null
  const u = o.message?.usage
  if (!u || typeof u !== 'object') return null
  const cwd = typeof o.cwd === 'string' ? o.cwd : ''
  const projectLabel = cwd ? (cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd) : 'unknown'
  const ts = Date.parse(o.timestamp ?? '')
  return {
    id: `${o.message?.id ?? ''}:${o.requestId ?? ''}`,
    ts: Number.isFinite(ts) ? ts : 0,
    model: prettyModel(typeof o.message?.model === 'string' ? o.message.model : 'unknown'),
    project: cwd || 'unknown',
    projectLabel,
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheCreate: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens)
  }
}

function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    messages: 0
  }
}

function add(t: UsageTotals, r: UsageRecord): void {
  t.inputTokens += r.input
  t.outputTokens += r.output
  t.cacheCreateTokens += r.cacheCreate
  t.cacheReadTokens += r.cacheRead
  t.totalTokens += r.input + r.output + r.cacheCreate + r.cacheRead
  t.messages += 1
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function dateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}
function dayLabel(ms: number): string {
  const d = new Date(ms)
  return `${`${d.getMonth() + 1}`.padStart(2, '0')}/${`${d.getDate()}`.padStart(2, '0')}`
}

/* ----------------------------- limit budgets ----------------------------- */

// Cost-weighted token units. Cache reads are ~free and barely count toward usage
// limits; output is the most expensive. Weighting like this makes the local
// estimate track Claude's own accounting — raw token totals are dominated by
// cache reads (often 10–100× the real input), which is what made the old
// estimate wildly wrong (97% "left" when /status said 45% used).
const WEIGHTS = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }

function weighted(r: UsageRecord): number {
  return (
    r.input * WEIGHTS.input +
    r.output * WEIGHTS.output +
    r.cacheCreate * WEIGHTS.cacheWrite +
    r.cacheRead * WEIGHTS.cacheRead
  )
}

export interface PlanBudgets {
  limit5h: number
  limitWeek: number
}

// Weighted-unit budgets per plan, calibrated against Claude Code's own /status
// ("Approximate, based on local sessions on this machine"): a Max 5x user's
// 5-hour window measured ~43.7M weighted at 45% used → ~97M, and ~176M weekly at
// 14% → ~1.26B. Pro is 1/5 of Max 5x; Max 20x is 4× it (20x ÷ 5x) — Anthropic's
// own plan ratios. These are estimates; /status remains the source of truth.
const PLAN: Record<'pro' | 'max5x' | 'max20x', PlanBudgets> = {
  pro: { limit5h: 19_400_000, limitWeek: 251_000_000 },
  max5x: { limit5h: 97_000_000, limitWeek: 1_257_000_000 },
  max20x: { limit5h: 388_000_000, limitWeek: 5_028_000_000 }
}

/** Map a Claude rate-limit tier string to a budget bracket. */
function budgetsForTier(tier: string | null): PlanBudgets {
  const t = (tier ?? '').toLowerCase()
  if (t.includes('20x')) return PLAN.max20x
  if (t.includes('5x') || t.includes('max')) return PLAN.max5x
  return PLAN.pro // pro / free / unknown — the conservative default
}

/** The user's Claude plan tier, read from local config (null if not found). */
export function readPlanTier(): string | null {
  const tryJson = (p: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const cfg = tryJson(join(homedir(), '.claude.json'))
  const acct = cfg?.oauthAccount as
    | { organizationRateLimitTier?: string; userRateLimitTier?: string }
    | undefined
  if (acct?.userRateLimitTier) return acct.userRateLimitTier
  if (acct?.organizationRateLimitTier) return acct.organizationRateLimitTier
  const creds = tryJson(join(homedir(), '.claude', '.credentials.json'))
  const oauth = creds?.claudeAiOauth as { rateLimitTier?: string } | undefined
  return oauth?.rateLimitTier ?? null
}

/** Resolve the budgets to use now: the user's chosen plan, or auto-detected. */
function currentBudgets(): PlanBudgets {
  const sel = getSettings().usage.plan
  if (sel !== 'auto' && sel in PLAN) return PLAN[sel as 'pro' | 'max5x' | 'max20x']
  return budgetsForTier(readPlanTier())
}

function floorTo(ms: number, unit: 'hour' | 'day'): number {
  const d = new Date(ms)
  d.setMinutes(0, 0, 0)
  if (unit === 'day') d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Model one rolling usage window the way Claude's limits behave: group activity
 * into fixed blocks that anchor at the first message and run for `windowMs`, with
 * a fresh block after a gap longer than the window. The current block's reset is
 * `anchor + windowMs` (a real time, not a guess). `used` is in cost-weighted
 * units and `limit` is the plan budget, so `percentUsed = used / limit` tracks
 * Claude's own /status (which is itself "based on local sessions"). Pure /
 * unit-testable.
 */
export function computeWindow(
  records: UsageRecord[],
  now: number,
  windowMs: number,
  limit: number,
  anchorUnit: 'hour' | 'day',
  auto = true
): UsageWindow {
  const sorted = records.filter((r) => r.ts > 0).sort((a, b) => a.ts - b.ts)
  interface Block {
    anchor: number
    lastTs: number
    used: number
  }
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const r of sorted) {
    if (!cur || r.ts - cur.anchor >= windowMs || r.ts - cur.lastTs >= windowMs) {
      cur = { anchor: floorTo(r.ts, anchorUnit), lastTs: r.ts, used: 0 }
      blocks.push(cur)
    }
    cur.used += weighted(r)
    cur.lastTs = r.ts
  }
  const last = blocks[blocks.length - 1]
  const active = !!last && now < last.anchor + windowMs
  const used = active ? last!.used : 0
  const resetAt = active ? last!.anchor + windowMs : null
  const safeLimit = Math.max(1, limit)
  const percentUsed = Math.min(100, Math.max(0, Math.round((used / safeLimit) * 100)))
  return {
    windowMs,
    used,
    limit: safeLimit,
    percentUsed,
    percentLeft: 100 - percentUsed,
    resetAt,
    auto
  }
}

/** Build the aggregated snapshot from raw records relative to `now`. Pure. */
export function buildSnapshot(
  records: UsageRecord[],
  now: number,
  budgets: PlanBudgets = PLAN.max5x
): UsageSnapshot {
  const today = emptyTotals()
  const last5h = emptyTotals()
  const last7d = emptyTotals()
  const last30d = emptyTotals()
  const allTime = emptyTotals()
  const startToday = startOfDay(now)
  const fiveHAgo = now - 5 * 3_600_000
  const sevenDAgo = now - 7 * DAY_MS
  const thirtyDAgo = now - WINDOW_DAYS * DAY_MS

  const dailyMap = new Map<string, UsageTotals>()
  const modelMap = new Map<string, UsageTotals>()
  const projMap = new Map<string, { label: string; t: UsageTotals }>()

  for (const r of records) {
    add(allTime, r)
    if (r.ts >= startToday) add(today, r)
    if (r.ts >= fiveHAgo) add(last5h, r)
    if (r.ts >= sevenDAgo) add(last7d, r)
    if (r.ts >= thirtyDAgo) {
      add(last30d, r)
      const dk = dateKey(r.ts)
      let dt = dailyMap.get(dk)
      if (!dt) {
        dt = emptyTotals()
        dailyMap.set(dk, dt)
      }
      add(dt, r)
      let mt = modelMap.get(r.model)
      if (!mt) {
        mt = emptyTotals()
        modelMap.set(r.model, mt)
      }
      add(mt, r)
      let pe = projMap.get(r.project)
      if (!pe) {
        pe = { label: r.projectLabel, t: emptyTotals() }
        projMap.set(r.project, pe)
      }
      add(pe.t, r)
    }
  }

  const daily: UsageBucket[] = []
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const dayMs = startToday - i * DAY_MS
    const dk = dateKey(dayMs)
    daily.push({ key: dk, label: dayLabel(dayMs), ...(dailyMap.get(dk) ?? emptyTotals()) })
  }

  const byModel: UsageBucket[] = [...modelMap.entries()]
    .map(([key, t]) => ({ key, label: key, ...t }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const byProject: UsageBucket[] = [...projMap.entries()]
    .map(([key, v]) => ({ key, label: v.label, ...v.t }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 8)

  return {
    updatedAt: now,
    fiveHour: computeWindow(records, now, 5 * 3_600_000, budgets.limit5h, 'hour'),
    weekly: computeWindow(records, now, 7 * DAY_MS, budgets.limitWeek, 'day'),
    today,
    last5h,
    last7d,
    last30d,
    allTime,
    daily,
    byModel,
    byProject,
    empty: records.length === 0
  }
}

/* --------------------------- live file scanning --------------------------- */

let records: UsageRecord[] = []
const seen = new Set<string>()
const offsets = new Map<string, number>()
let started = false
let timer: ReturnType<typeof setInterval> | null = null
let scanning: Promise<boolean> | null = null

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

async function listTranscripts(): Promise<string[]> {
  let dirs: string[]
  try {
    dirs = await readdir(PROJECTS_DIR)
  } catch {
    return [] // no ~/.claude/projects yet
  }
  const out: string[] = []
  for (const d of dirs) {
    const dir = join(PROJECTS_DIR, d)
    try {
      const files = await readdir(dir)
      for (const f of files) if (f.endsWith('.jsonl')) out.push(join(dir, f))
    } catch {
      // not a directory / unreadable — skip
    }
  }
  return out
}

/** Tail any new bytes from changed transcripts into `records`. Returns true if
 * anything new was added. */
async function scanOnce(): Promise<boolean> {
  const files = await listTranscripts()
  const cutoff = Date.now() - KEEP_DAYS * DAY_MS
  let changed = false
  for (const path of files) {
    let size: number
    let mtime: number
    try {
      const st = await stat(path)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      continue
    }
    const prev = offsets.get(path) ?? 0
    // Never-read file that's older than our retention window — skip its history.
    if (prev === 0 && mtime < cutoff) {
      offsets.set(path, size)
      continue
    }
    if (size < prev) offsets.set(path, 0) // rotated / truncated → re-read
    const start = offsets.get(path) ?? 0
    if (size <= start) continue
    let text: string
    try {
      text = await readSlice(path, start, size)
    } catch {
      continue
    }
    const lastNl = text.lastIndexOf('\n')
    if (lastNl < 0) continue // no complete line appended yet
    const complete = text.slice(0, lastNl)
    offsets.set(path, start + Buffer.byteLength(complete, 'utf8') + 1)
    for (const line of complete.split('\n')) {
      const rec = parseUsageLine(line)
      if (!rec) continue
      if (rec.id !== ':' && seen.has(rec.id)) continue
      if (rec.id !== ':') seen.add(rec.id)
      records.push(rec)
      changed = true
    }
  }
  if (changed) {
    const keep = Date.now() - KEEP_DAYS * DAY_MS
    records = records.filter((r) => r.ts >= keep || r.ts === 0)
  }
  return changed
}

function scan(): Promise<boolean> {
  if (!scanning) {
    scanning = scanOnce().finally(() => {
      scanning = null
    })
  }
  return scanning
}

/** An all-zero snapshot (Usage turned off — nothing read, nothing shown). */
function emptySnapshot(): UsageSnapshot {
  return buildSnapshot([], Date.now())
}

function broadcast(): void {
  const snap = getSettings().usage.enabled
    ? buildSnapshot(records, Date.now(), currentBudgets())
    : emptySnapshot()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('usage:changed', snap)
  }
}

/** Current snapshot, after ensuring at least one (de-duped) scan has run. Returns
 * an empty snapshot (and reads nothing) when the user has turned Usage off. */
export async function getUsageSnapshot(): Promise<UsageSnapshot> {
  if (!getSettings().usage.enabled) return emptySnapshot()
  await scan()
  return buildSnapshot(records, Date.now(), currentBudgets())
}

/** Start tailing transcripts: once shortly after launch, then every few seconds.
 * Skips entirely while Usage is disabled, so nothing is read from disk. */
export function startUsageWatcher(): void {
  if (started) return
  started = true
  const tick = (): void => {
    if (!getSettings().usage.enabled) return
    void scan().then((c) => {
      if (c) broadcast()
    })
  }
  tick()
  timer = setInterval(tick, POLL_MS)
}

export function stopUsageWatcher(): void {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}
