import { useEffect } from 'react'
import { Activity } from 'lucide-react'
import { useUsageStore } from '../../state/useUsageStore'
import { useAppStore } from '../../state/useAppStore'
import { fmtTokens } from './format'
import { useLiveUsage } from './useLiveUsage'
import { UsageReadout } from './UsageReadout'
import { hasNoData, readingsFor, usageTooltip } from '../../state/usageView'

const NO_DATA_TIP = 'No usage data yet. Start Claude in a DockTerm terminal to see your real usage.'

/** Compact, always-visible readout of Claude's REAL usage (the numbers Claude Code
 * itself reports), in the metrics and style chosen in the Usage panel. Clicking
 * opens the panel. With `usage.source = local` it shows the old local token count,
 * labelled as an estimate. */
export function UsagePill() {
  const enabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  const source = useAppStore((s) => s.settings?.usage.source) ?? 'claude'
  const cfg = useAppStore((s) => s.settings?.usage.pill)
  const openPanel = useAppStore((s) => s.openPanel)
  const toggle = useAppStore((s) => s.togglePanel)
  const { real, history, now } = useLiveUsage(enabled && source === 'claude')

  const snap = useUsageStore((s) => s.snapshot)
  const load = useUsageStore((s) => s.load)
  useEffect(() => {
    if (enabled && source === 'local') void load()
  }, [load, enabled, source])

  if (!enabled || !cfg) return null
  const cls = `usage-pill${openPanel === 'usage' ? ' usage-pill--active' : ''}`

  if (source === 'local') {
    if (!snap || snap.empty) return null
    const tip = `Estimate from local transcripts, not Claude's own limit: ${fmtTokens(snap.last5h.totalTokens)} tokens in the last 5 hours, ${fmtTokens(snap.last7d.totalTokens)} in the last 7 days`
    return (
      <button className={cls} title={tip} aria-label={tip} onClick={() => toggle('usage')}>
        <Activity size={13} className="usage-pill__icon" />
        <span className="usage-pill__pct">{fmtTokens(snap.last5h.totalTokens)}</span>
        <span className="usage-pill__sub">5h estimate</span>
      </button>
    )
  }

  const th = { warnAt: cfg.warnAt, critAt: cfg.critAt }
  const readings = readingsFor(real, cfg.show, th)
  const none = hasNoData(readings)
  const tip = none && !real ? NO_DATA_TIP : usageTooltip(real, now, history, th)
  return (
    <button
      className={`${cls}${none ? ' usage-pill--quiet' : ''}`}
      title={tip}
      aria-label={tip.split('\n')[0]}
      onClick={() => toggle('usage')}
    >
      {none ? (
        <>
          <Activity size={13} className="usage-pill__icon" />
          <span className="uv-nodata">{real ? 'no limit data' : 'no data yet'}</span>
        </>
      ) : (
        <UsageReadout
          readings={readings}
          style={cfg.style}
          showReset={cfg.showReset}
          real={real}
          history={history}
          now={now}
          variant="pill"
        />
      )}
    </button>
  )
}
