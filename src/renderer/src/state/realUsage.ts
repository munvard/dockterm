import type { RealUsage, RealUsageWindow } from '@shared/usageReal'

/** Same data, with any window whose reset time has passed dropped (Claude drops
 * it too). Returns the SAME object when nothing expired, so selectors stay stable.
 * Call it with a ticking `now` so a window that ends disappears on screen. */
export function pruneRealUsage(real: RealUsage | null, now: number): RealUsage | null {
  if (!real) return real
  const live = (w: RealUsageWindow | null): RealUsageWindow | null => (w && w.resetsAt > now ? w : null)
  const fiveHour = live(real.fiveHour)
  const sevenDay = live(real.sevenDay)
  if (fiveHour === real.fiveHour && sevenDay === real.sevenDay) return real
  return { ...real, fiveHour, sevenDay }
}

/** The store's reaction to a pushed value: always take it (main already
 * de-duplicated and pruned), but keep the object identity when it is equal. */
export function reduceReal(prev: RealUsage | null, next: RealUsage | null): RealUsage | null {
  if (prev === next) return prev
  if (!prev || !next) return next
  const w = (a: RealUsageWindow | null, b: RealUsageWindow | null): boolean =>
    a === b || (!!a && !!b && a.pct === b.pct && a.resetsAt === b.resetsAt)
  return w(prev.fiveHour, next.fiveHour) &&
    w(prev.sevenDay, next.sevenDay) &&
    prev.updatedAt === next.updatedAt &&
    prev.capturedAt === next.capturedAt &&
    prev.contextPct === next.contextPct &&
    prev.model === next.model &&
    prev.costUsd === next.costUsd
    ? prev
    : next
}
