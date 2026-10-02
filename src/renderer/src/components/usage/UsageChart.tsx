import { useState } from 'react'
import type { RealUsage } from '@shared/usageReal'
import { seriesOf, type UsageSample } from '@shared/usageHistory'
import { FIVE_HOUR_MS, SEVEN_DAY_MS, paceLine, sparkPath } from '../../state/usageView'

const W = 240
const H = 64

/** Real percentage samples over the last 5 hours or 24 hours, drawn by hand. */
export function UsageChart({
  history,
  now,
  real,
  showPace
}: {
  history: UsageSample[]
  now: number
  real: RealUsage | null
  showPace: boolean
}) {
  const [hours, setHours] = useState<5 | 24>(5)
  const from = now - hours * 3_600_000
  const five = seriesOf(history, 'fiveHour', from)
  const seven = seriesOf(history, 'sevenDay', from)
  const paceFive = showPace && real?.fiveHour ? paceLine(real.fiveHour.resetsAt, FIVE_HOUR_MS, from, now) : []
  const paceSeven = showPace && real?.sevenDay ? paceLine(real.sevenDay.resetsAt, SEVEN_DAY_MS, from, now) : []
  const count = history.filter((s) => s.t >= from).length
  return (
    <div className="usage-section">
      <div className="usage-section__head">
        <span>History</span>
        <span className="uset-seg uset-seg--tiny">
          {([5, 24] as const).map((h) => (
            <button key={h} className={hours === h ? 'is-on' : ''} onClick={() => setHours(h)}>
              {h}h
            </button>
          ))}
        </span>
      </div>
      {count < 2 ? (
        <div className="usage-note usage-note--flush">collecting data</div>
      ) : (
        <>
          <svg className="uchart" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
            {[25, 50, 75].map((p) => (
              <line key={p} className="uchart__grid" x1={0} x2={W} y1={H - (p / 100) * (H - 2) - 1} y2={H - (p / 100) * (H - 2) - 1} />
            ))}
            {paceSeven.length > 0 && (
              <path className="uchart__pace uchart__pace--seven" d={sparkPath(paceSeven, from, now, W, H)} fill="none" vectorEffect="non-scaling-stroke" />
            )}
            {paceFive.length > 0 && (
              <path className="uchart__pace uchart__pace--five" d={sparkPath(paceFive, from, now, W, H)} fill="none" vectorEffect="non-scaling-stroke" />
            )}
            {seven.map((pts, i) => (
              <path key={`s${i}`} className="uchart__seven" d={sparkPath(pts, from, now, W, H)} fill="none" vectorEffect="non-scaling-stroke" />
            ))}
            {five.map((pts, i) => (
              <path key={`f${i}`} className="uchart__five" d={sparkPath(pts, from, now, W, H)} fill="none" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          <div className="uchart__legend">
            <span><i className="uchart__dot uchart__dot--five" /> 5-hour</span>
            <span><i className="uchart__dot uchart__dot--seven" /> 7-day</span>
            <span>{paceFive.length > 0 || paceSeven.length > 0 ? 'dashed = even pace' : '0 to 100% used'}</span>
          </div>
        </>
      )}
    </div>
  )
}
