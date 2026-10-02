import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendSample, pruneSamples, sampleFromReal, sanitizeSamples, type UsageSample } from '@shared/usageHistory'
import { getRealUsage } from './usageCaptureService'

/**
 * A small local ring of REAL percentage samples (what Claude reported, stamped with
 * the time of that report). One JSON file in userData, at most one sample per
 * minute, seven days. It only reads the in-memory capture: no network, no polling
 * of files, nothing estimated.
 */

const TICK_MS = 30_000
const FLUSH_MS = 5 * 60_000

let samples: UsageSample[] = []
let loaded = false
let tick: ReturnType<typeof setInterval> | null = null
let dirty = false
let lastFlush = 0

function file(): string {
  return join(app.getPath('userData'), 'usage-history.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    samples = pruneSamples(sanitizeSamples(JSON.parse(readFileSync(file(), 'utf8'))), Date.now())
  } catch {
    samples = []
  }
}

export function flushUsageHistory(): void {
  if (!dirty) return
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = `${file()}.tmp`
    writeFileSync(tmp, JSON.stringify({ v: 1, samples }), 'utf8')
    renameSync(tmp, file())
    dirty = false
    lastFlush = Date.now()
  } catch {
    // history is a convenience: never let a full disk break the app
  }
}

function record(): void {
  const s = sampleFromReal(getRealUsage())
  if (!s) return
  const now = Date.now()
  const next = appendSample(samples, s, now)
  if (next === samples) return
  samples = next
  dirty = true
  if (now - lastFlush >= FLUSH_MS) flushUsageHistory()
}

export function startUsageHistory(): void {
  if (tick) return
  load()
  record()
  tick = setInterval(record, TICK_MS)
  tick.unref()
}

export function stopUsageHistory(): void {
  if (tick) clearInterval(tick)
  tick = null
  record()
  flushUsageHistory()
}

/** Samples of the last `hours` hours (default: everything kept), oldest first. */
export function getUsageHistory(hours?: number): UsageSample[] {
  load()
  if (!hours) return samples
  const from = Date.now() - hours * 3_600_000
  return samples.filter((s) => s.t >= from)
}
