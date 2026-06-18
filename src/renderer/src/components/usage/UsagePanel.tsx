import { useEffect } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { useUsageStore } from '../../state/useUsageStore'
import type { UsageTotals, UsageBucket } from '@shared/types'
import { fmtTokens } from './format'

const SEG_COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--text-faint)']
const SEG_LABELS = ['Input', 'Output', 'Cache write', 'Cache read'] as const

function parts(t: UsageTotals): number[] {
  return [t.inputTokens, t.outputTokens, t.cacheCreateTokens, t.cacheReadTokens]
}

/** Composition donut for today's tokens, with the live total in the center. */
function Donut({ total }: { total: UsageTotals }) {
  const vals = parts(total)
  const sum = vals.reduce((a, v) => a + v, 0) || 1
  const R = 52
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="usage-donut">
      <svg viewBox="0 0 130 130" width="118" height="118">
        <circle cx="65" cy="65" r={R} className="usage-donut__track" fill="none" strokeWidth="13" />
        {vals.map((v, i) => {
          const frac = v / sum
          const dash = `${frac * C} ${C}`
          const off = -acc * C
          acc += frac
          return (
            <circle
              key={i}
              cx="65"
              cy="65"
              r={R}
              fill="none"
              strokeWidth="13"
              stroke={SEG_COLORS[i]}
              strokeDasharray={dash}
              strokeDashoffset={off}
              transform="rotate(-90 65 65)"
            />
          )
        })}
      </svg>
      <div className="usage-donut__center">
        <div className="usage-donut__num">{fmtTokens(total.totalTokens)}</div>
        <div className="usage-donut__cap">tokens today</div>
      </div>
    </div>
  )
}

/** 30-day token area chart. */
function Spark({ daily }: { daily: UsageBucket[] }) {
  const vals = daily.map((d) => d.totalTokens)
  const max = Math.max(1, ...vals)
  const W = 240
  const H = 52
  const n = vals.length
  const pts = vals.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * W
    const y = H - (v / max) * (H - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  return (
    <svg
      className="usage-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      width="100%"
      height={H}
    >
      <path d={area} className="usage-spark__area" />
      <path d={line} className="usage-spark__line" fill="none" />
    </svg>
  )
}

function Bars({ rows }: { rows: UsageBucket[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens))
  return (
    <div className="usage-bars">
      {rows.map((r) => (
        <div className="usage-bar" key={r.key} title={r.key}>
          <span className="usage-bar__label">{r.label}</span>
          <span className="usage-bar__track">
            <span className="usage-bar__fill" style={{ width: `${(r.totalTokens / max) * 100}%` }} />
          </span>
          <span className="usage-bar__val">{fmtTokens(r.totalTokens)}</span>
        </div>
      ))}
    </div>
  )
}

export function UsagePanel() {
  const snap = useUsageStore((s) => s.snapshot)
  const load = useUsageStore((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])

  const stat = (label: string, t: UsageTotals) => (
    <div className="usage-stat" key={label}>
      <div className="usage-stat__val">{fmtTokens(t.totalTokens)}</div>
      <div className="usage-stat__label">{label}</div>
    </div>
  )

  const cacheEff = (t: UsageTotals): number => {
    const base = t.inputTokens + t.cacheReadTokens
    return base ? Math.round((t.cacheReadTokens / base) * 100) : 0
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Usage</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void load()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        {!snap || snap.empty ? (
          <div className="mcp-empty">
            <Activity size={15} /> No Claude usage yet. As you run Claude in DockTerm&apos;s
            terminals, your token usage shows up here — live.
          </div>
        ) : (
          <>
            <div className="usage-hero">
              <Donut total={snap.today} />
              <div className="usage-legend">
                {SEG_LABELS.map((label, i) => (
                  <div className="usage-legend__row" key={label}>
                    <span className="usage-legend__dot" style={{ background: SEG_COLORS[i] }} />
                    <span className="usage-legend__label">{label}</span>
                    <span className="usage-legend__val">{fmtTokens(parts(snap.today)[i])}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="usage-stats">
              {stat('Last 5h', snap.last5h)}
              {stat('7 days', snap.last7d)}
              {stat('30 days', snap.last30d)}
              {stat('All time', snap.allTime)}
            </div>

            <div className="usage-section">
              <div className="usage-section__head">
                <span>Last {snap.daily.length} days</span>
                <span className="usage-live">
                  <span className="usage-live__dot" /> live
                </span>
              </div>
              <Spark daily={snap.daily} />
            </div>

            <div className="usage-section">
              <div className="usage-section__head">
                <span>Cache efficiency · 30 days</span>
              </div>
              <div className="usage-cache">
                <div className="usage-cache__pct">{cacheEff(snap.last30d)}%</div>
                <div className="usage-cache__cap">
                  of input tokens were served from cache — fewer fresh tokens to process.
                </div>
              </div>
            </div>

            {snap.byModel.length > 0 && (
              <div className="usage-section">
                <div className="usage-section__head">
                  <span>By model · 30 days</span>
                </div>
                <Bars rows={snap.byModel} />
              </div>
            )}

            {snap.byProject.length > 0 && (
              <div className="usage-section">
                <div className="usage-section__head">
                  <span>By project · 30 days</span>
                </div>
                <Bars rows={snap.byProject} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
