import { useEffect, useMemo } from 'react'
import type { RealUsage } from '@shared/usageReal'
import type { UsageSample } from '@shared/usageHistory'
import { useUsageStore } from '../../state/useUsageStore'
import { pruneRealUsage } from '../../state/realUsage'
import { useNowTick } from './useNowTick'

/** The real usage with expired windows already dropped (re-evaluated on a tick),
 * the local real-sample history, and the clock the countdowns use. */
export function useLiveUsage(active = true): { real: RealUsage | null; history: UsageSample[]; now: number } {
  const raw = useUsageStore((s) => s.real)
  const history = useUsageStore((s) => s.history)
  const loadReal = useUsageStore((s) => s.loadReal)
  const loadHistory = useUsageStore((s) => s.loadHistory)
  const now = useNowTick(15_000)

  useEffect(() => {
    if (!active) return
    void loadReal()
    void loadHistory()
    const id = setInterval(() => void loadHistory(), 60_000)
    return () => clearInterval(id)
  }, [active, loadReal, loadHistory])

  const real = useMemo(() => pruneRealUsage(raw, now), [raw, now])
  return { real, history, now }
}
