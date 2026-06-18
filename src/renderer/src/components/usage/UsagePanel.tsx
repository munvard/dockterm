import { useEffect } from 'react'
import { Activity, RefreshCw, Clock } from 'lucide-react'
import { useUsageStore } from '../../state/useUsageStore'
import { useAppStore } from '../../state/useAppStore'
import type { UsageWindow, UsageBucket } from '@shared/types'
import { Ring } from './Ring'
import { useNowTick } from './useNowTick'
import { fmtTokens, fmtCountdown, fmtResetClock, toneColor } from './format'

/** Headline card for one rolling limit window: a ring of remaining headroom +
 * when it resets. */
function WindowCard({ title, w, now }: { title: string; w: UsageWindow; now: number }) {
  const left = w.percentLeft
  const tone = toneColor(left)
  return (
    <div className="usage-win">
      <Ring pct={left} size={104} stroke={10} color={tone}>
        <div className="usage-win__pct" style={{ color: tone }}>
          {left}%
        </div>
        <div className="usage-win__cap">left</div>
      </Ring>
      <div className="usage-win__meta">
        <div className="usage-win__title">{title}</div>
        {w.resetAt ? (
          <div className="usage-win__reset">
            <Clock size={12} /> Resets in <b>{fmtCountdown(w.resetAt - now)}</b>
            <span className="usage-win__at">· {fmtResetClock(w.resetAt)}</span>
          </div>
        ) : (
          <div className="usage-win__reset usage-win__reset--idle">
            Fresh — resets once you start
          </div>
        )}
        <div className="usage-win__track">
          <span
            className="usage-win__fill"
            style={{ width: `${w.percentUsed}%`, background: tone }}
          />
        </div>
      </div>
    </div>
  )
}

/** 30-day token trend (relative, not a running total). */
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
  const enabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  const now = useNowTick()
  useEffect(() => {
    if (enabled) void load()
  }, [load, enabled])

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
        {!enabled ? (
          <div className="mcp-empty">
            <Activity size={15} /> Usage is turned off. Turn it back on in{' '}
            <b>Settings → Usage</b>.
          </div>
        ) : !snap || snap.empty ? (
          <div className="mcp-empty">
            <Activity size={15} /> No Claude usage found yet. As you run Claude in a terminal,
            your remaining limits show up here — live. (If you don&apos;t use Claude Code on this
            machine, there&apos;s nothing to show.)
          </div>
        ) : (
          <>
            <WindowCard title="5-hour limit" w={snap.fiveHour} now={now} />
            <WindowCard title="Weekly limit" w={snap.weekly} now={now} />

            <div className="usage-note">
              Estimated from your local sessions — for exact figures, run <code>/status</code> in
              Claude Code.
            </div>

            <div className="usage-section">
              <div className="usage-section__head">
                <span>Activity · last {snap.daily.length} days</span>
                <span className="usage-live">
                  <span className="usage-live__dot" /> live
                </span>
              </div>
              <Spark daily={snap.daily} />
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
