import { useEffect } from 'react'
import { useUsageStore } from '../../state/useUsageStore'
import { useAppStore } from '../../state/useAppStore'
import { Ring } from './Ring'
import { useNowTick } from './useNowTick'
import { fmtCountdown, toneColor } from './format'

/** Compact, always-visible readout of how much of your 5-hour usage window is
 * left + when it resets. Clicking opens the full Usage panel. Hidden until
 * there's any usage to base it on. */
export function UsagePill() {
  const snap = useUsageStore((s) => s.snapshot)
  const load = useUsageStore((s) => s.load)
  const enabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  const openPanel = useAppStore((s) => s.openPanel)
  const toggle = useAppStore((s) => s.togglePanel)
  const now = useNowTick()

  useEffect(() => {
    if (enabled) void load()
  }, [load, enabled])

  if (!enabled || !snap || snap.empty) return null

  const w = snap.fiveHour
  const left = w.percentLeft
  const reset = w.resetAt ? fmtCountdown(w.resetAt - now) : null
  const tip =
    `5-hour usage: ${left}% left` +
    (w.resetAt ? ` · resets in ${reset}` : ' · window is fresh') +
    ` — Week: ${snap.weekly.percentLeft}% left`

  return (
    <button
      className={`usage-pill${openPanel === 'usage' ? ' usage-pill--active' : ''}`}
      data-tip={tip}
      aria-label={tip}
      onClick={() => toggle('usage')}
    >
      <Ring pct={left} size={15} stroke={3} color={toneColor(left)} />
      <span className="usage-pill__pct">{left}%</span>
      {reset && <span className="usage-pill__sub">{reset}</span>}
    </button>
  )
}
