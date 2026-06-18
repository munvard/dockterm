import { useEffect } from 'react'
import { Activity } from 'lucide-react'
import { useUsageStore } from '../../state/useUsageStore'
import { useAppStore } from '../../state/useAppStore'
import { fmtTokens } from './format'

/** Compact, always-visible live readout of today's Claude tokens. Clicking it
 * opens the full Usage panel. Hidden until there's any usage to show. */
export function UsagePill() {
  const snap = useUsageStore((s) => s.snapshot)
  const load = useUsageStore((s) => s.load)
  const openPanel = useAppStore((s) => s.openPanel)
  const toggle = useAppStore((s) => s.togglePanel)

  useEffect(() => {
    void load()
  }, [load])

  if (!snap || snap.empty) return null
  return (
    <button
      className={`usage-pill${openPanel === 'usage' ? ' usage-pill--active' : ''}`}
      data-tip="Claude usage today"
      aria-label="Claude usage today"
      onClick={() => toggle('usage')}
    >
      <Activity size={12} />
      <span>{fmtTokens(snap.today.totalTokens)}</span>
    </button>
  )
}
