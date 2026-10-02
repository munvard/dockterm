import { useEffect } from 'react'
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { useUsageStore } from '../../state/useUsageStore'
import { useAppStore } from '../../state/useAppStore'
import type { UsageBucket } from '@shared/types'
import {
  USAGE_METRICS,
  USAGE_STYLES,
  type UsageMetric,
  type UsageStyle
} from '@shared/usageReal'
import { fmtCountdown, fmtResetClock, fmtTokens } from './format'
import { useLiveUsage } from './useLiveUsage'
import { UsageReadout } from './UsageReadout'
import { UsageChart } from './UsageChart'
import {
  METRIC_NAME,
  burnRate,
  fmtAge,
  fmtClock,
  fmtCost,
  fmtPct,
  fmtRate,
  moveMetric,
  noDataNote,
  noWindowsNote,
  readingFor,
  readingsFor,
  setThreshold,
  toggleMetric,
  type Reading
} from '../../state/usageView'

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
    <svg className="usage-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}>
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

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle${checked ? ' toggle--on' : ''}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="toggle__knob" />
    </button>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="uset-row">
      <span className="uset-row__label">{label}</span>
      <div className="uset-row__control">{children}</div>
    </div>
  )
}

const STYLE_LABEL: Record<UsageStyle, string> = { percent: 'Percent', bar: 'Bar', ring: 'Ring', graph: 'Graph' }

function StylePicker({ value, onChange }: { value: UsageStyle; onChange: (s: UsageStyle) => void }) {
  return (
    <span className="uset-seg">
      {USAGE_STYLES.map((s) => (
        <button key={s} className={value === s ? 'is-on' : ''} onClick={() => onChange(s)}>
          {STYLE_LABEL[s]}
        </button>
      ))}
    </span>
  )
}

function MetricPicker({ show, onChange }: { show: UsageMetric[]; onChange: (s: UsageMetric[]) => void }) {
  const ordered = [...show, ...USAGE_METRICS.filter((m) => !show.includes(m))]
  return (
    <div className="uset-metrics">
      {ordered.map((m) => {
        const on = show.includes(m)
        const i = show.indexOf(m)
        return (
          <div key={m} className="uset-metric">
            <label>
              <input type="checkbox" checked={on} onChange={() => onChange(toggleMetric(show, m))} />
              <span>{METRIC_NAME[m]}</span>
            </label>
            {on && show.length > 1 && (
              <span className="uset-metric__move">
                <button className="iconbtn iconbtn--sm" title="Move up" disabled={i === 0} onClick={() => onChange(moveMetric(show, m, -1))}>
                  <ChevronUp size={12} />
                </button>
                <button className="iconbtn iconbtn--sm" title="Move down" disabled={i === show.length - 1} onClick={() => onChange(moveMetric(show, m, 1))}>
                  <ChevronDown size={12} />
                </button>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WindowCard({ r, now }: { r: Reading; now: number }) {
  return (
    <div className={`unow uv--${r.tone}`}>
      <div className="unow__top">
        <span className="unow__name">{METRIC_NAME[r.metric]}</span>
        <span className="unow__val">{r.text}</span>
      </div>
      <span className="uv-bar uv-bar--wide">
        <i style={{ width: `${Math.min(100, Math.max(0, r.pct ?? 0))}%` }} />
      </span>
      <div className="unow__sub">
        {r.known && r.resetsAt !== null
          ? `Resets ${fmtResetClock(r.resetsAt)} (in ${fmtCountdown(r.resetsAt - now)})`
          : 'No data (window has reset, or no limit info yet)'}
      </div>
    </div>
  )
}

function NumField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <input
      key={value}
      className="settings-num"
      type="number"
      min={1}
      max={100}
      defaultValue={value}
      onBlur={(e) => {
        const n = Number.parseFloat(e.target.value)
        if (Number.isFinite(n) && n !== value) onCommit(n)
        else e.target.value = String(value)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

const SIZES = { Small: { w: 180, h: 80 }, Medium: { w: 260, h: 120 }, Large: { w: 360, h: 180 } } as const

export function UsagePanel() {
  const snap = useUsageStore((s) => s.snapshot)
  const load = useUsageStore((s) => s.load)
  const loadReal = useUsageStore((s) => s.loadReal)
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updatePreferences)
  const enabled = settings?.usage.enabled ?? true
  const { real, history, now } = useLiveUsage(enabled)
  useEffect(() => {
    if (enabled) void load()
  }, [load, enabled])

  const u = settings?.usage
  const setPill = (p: Partial<NonNullable<typeof u>['pill']>): void => void update({ usage: { pill: p } })
  const setFloat = (p: Partial<NonNullable<typeof u>['float']>): void => void update({ usage: { float: p } })

  const th = { warnAt: u?.pill.warnAt ?? 75, critAt: u?.pill.critAt ?? 90 }
  const five = readingFor(real, 'fiveHour', th)
  const seven = readingFor(real, 'sevenDay', th)
  const ctx = readingFor(real, 'context', th)
  const rate = real?.fiveHour ? burnRate(history, real.fiveHour.resetsAt, now) : null

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Usage</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => { void load(); void loadReal() }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        {!enabled || !u ? (
          <div className="mcp-empty">
            <Activity size={15} /> Usage is turned off. Turn it back on in <b>Settings → Usage</b>.
          </div>
        ) : (
          <>
            <div className="usage-section usage-section--first">
              <div className="usage-section__head">
                <span>Your real usage</span>
                <span className="usage-live">
                  <span className="usage-live__dot" /> live
                </span>
              </div>
              {!real ? (
                <div className="usage-note usage-note--flush">
                  {noDataNote(u.captureEnabled, u.captureWithoutStatusLine)}
                </div>
              ) : (
                <>
                  <WindowCard r={five} now={now} />
                  <WindowCard r={seven} now={now} />
                  <div className="unow-facts">
                    {ctx.known && (
                      <div className="unow-fact">
                        <span>Context window</span>
                        <span className="unow-fact__bar uv--ok">
                          <span className={`uv-bar uv--${ctx.tone}`}>
                            <i style={{ width: `${Math.min(100, ctx.pct ?? 0)}%` }} />
                          </span>
                          <b>{fmtPct(ctx.pct ?? 0)}</b>
                        </span>
                      </div>
                    )}
                    {real.costUsd !== null && (
                      <div className="unow-fact">
                        <span>Session cost</span>
                        <b title="Claude's own estimate for the latest session">{fmtCost(real.costUsd)}</b>
                      </div>
                    )}
                    {real.model && (
                      <div className="unow-fact">
                        <span>Model</span>
                        <b>{real.model}</b>
                      </div>
                    )}
                    {real.fiveHour && (
                      <div className="unow-fact">
                        <span>5-hour window ends</span>
                        <b>{fmtClock(real.fiveHour.resetsAt)}</b>
                      </div>
                    )}
                    {rate !== null && (
                      <div className="unow-fact">
                        <span>Burn rate (last hour)</span>
                        <b>{fmtRate(rate)}</b>
                      </div>
                    )}
                    <div className="unow-fact unow-fact--dim">
                      <span>Updated</span>
                      <span>{real.updatedAt !== null ? fmtAge(now - real.updatedAt) : 'no limit info yet'}</span>
                    </div>
                  </div>
                  {noWindowsNote(real) && <div className="usage-note usage-note--flush">{noWindowsNote(real)}</div>}
                </>
              )}
            </div>

            <UsageChart history={history} now={now} />

            <div className="settings-section">
              <div className="settings-section__title">Top bar pill</div>
              <div className="uset-preview">
                <div className="usage-pill usage-pill--preview">
                  {readingsFor(real, u.pill.show, th).every((r) => !r.known) ? (
                    <span className="uv-nodata">{real ? 'no limit data' : 'no data yet'}</span>
                  ) : (
                    <UsageReadout
                      readings={readingsFor(real, u.pill.show, th)}
                      style={u.pill.style}
                      showReset={u.pill.showReset}
                      real={real}
                      history={history}
                      now={now}
                      variant="pill"
                    />
                  )}
                </div>
              </div>
              <MetricPicker show={u.pill.show} onChange={(show) => setPill({ show })} />
              <Row label="Style">
                <StylePicker value={u.pill.style} onChange={(style) => setPill({ style })} />
              </Row>
              <Row label="Show reset time">
                <Toggle checked={u.pill.showReset} onChange={(showReset) => setPill({ showReset })} />
              </Row>
              <Row label="Amber at (% used)">
                <NumField value={u.pill.warnAt} onCommit={(v) => setPill(setThreshold(u.pill, 'warnAt', v))} />
              </Row>
              <Row label="Red at (% used)">
                <NumField value={u.pill.critAt} onCommit={(v) => setPill(setThreshold(u.pill, 'critAt', v))} />
              </Row>
            </div>

            <div className="settings-section">
              <div className="settings-section__title">Floating widget</div>
              <Row label="Show floating widget">
                <Toggle checked={u.float.enabled} onChange={(enabled) => setFloat({ enabled })} />
              </Row>
              {u.float.enabled && (
                <>
                  <Row label="Always on top">
                    <Toggle checked={u.float.alwaysOnTop} onChange={(alwaysOnTop) => setFloat({ alwaysOnTop })} />
                  </Row>
                  <Row label={`Opacity ${Math.round(u.float.opacity * 100)}%`}>
                    <input
                      type="range"
                      min={30}
                      max={100}
                      step={5}
                      value={Math.round(u.float.opacity * 100)}
                      onChange={(e) => setFloat({ opacity: Number(e.target.value) / 100 })}
                    />
                  </Row>
                  <Row label="Size">
                    <span className="uset-seg">
                      {Object.entries(SIZES).map(([name, s]) => (
                        <button
                          key={name}
                          className={u.float.w === s.w && u.float.h === s.h ? 'is-on' : ''}
                          onClick={() => setFloat(s)}
                        >
                          {name}
                        </button>
                      ))}
                    </span>
                  </Row>
                  <MetricPicker show={u.float.show} onChange={(show) => setFloat({ show })} />
                  <Row label="Style">
                    <StylePicker value={u.float.style} onChange={(style) => setFloat({ style })} />
                  </Row>
                  <Row label="Show reset time">
                    <Toggle checked={u.float.showReset} onChange={(showReset) => setFloat({ showReset })} />
                  </Row>
                  <Row label="Position">
                    <button className="btn btn--ghost btn--sm" onClick={() => setFloat({ x: null, y: null })}>
                      Reset position
                    </button>
                  </Row>
                </>
              )}
              <div className="usage-note usage-note--flush">
                Drag it anywhere and resize it by its edges. Its cog menu changes the style, metrics and opacity.
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-section__title">Data</div>
              <Row label="Show">
                <span className="uset-seg">
                  <button className={u.source === 'claude' ? 'is-on' : ''} onClick={() => void update({ usage: { source: 'claude' } })}>
                    Real
                  </button>
                  <button className={u.source === 'local' ? 'is-on' : ''} onClick={() => void update({ usage: { source: 'local' } })}>
                    Local estimate
                  </button>
                </span>
              </Row>
              <Row label="Capture from terminals">
                <Toggle checked={u.captureEnabled} onChange={(captureEnabled) => void update({ usage: { captureEnabled } })} />
              </Row>
              <Row label="Also without a status line">
                <Toggle
                  checked={u.captureWithoutStatusLine}
                  onChange={(captureWithoutStatusLine) => void update({ usage: { captureWithoutStatusLine } })}
                />
              </Row>
              <div className="usage-note usage-note--flush">
                DockTerm starts Claude with its own status line setting that saves the limits Claude reports to a
                file on this machine, and still runs your own status line. Nothing is sent anywhere. If you have no
                status line of your own, capture stays off, because adding one gives Claude an extra footer row
                and replaces its "? for shortcuts" hint; turn on "Also without a status line" to accept that. A
                change applies to terminals opened after it. The local token count is an estimate and is never
                shown as a percentage.
              </div>
            </div>

            {snap && !snap.empty && (
              <>
                <div className="usage-section">
                  <div className="usage-section__head">
                    <span>Local tokens · last 5 hours / 7 days</span>
                  </div>
                  <div className="usage-note usage-note--flush">
                    {fmtTokens(snap.last5h.totalTokens)} / {fmtTokens(snap.last7d.totalTokens)} tokens counted from
                    local sessions (a count, not your limit).
                  </div>
                </div>
                <div className="usage-section">
                  <div className="usage-section__head">
                    <span>Activity · last {snap.daily.length} days</span>
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
          </>
        )}
      </div>
    </div>
  )
}
