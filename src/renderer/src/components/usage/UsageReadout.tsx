import { useEffect, useState } from 'react'
import type { RealUsage, UsageStyle } from '@shared/usageReal'
import type { UsageSample } from '@shared/usageHistory'
import { Ring } from './Ring'
import {
  hasNoData,
  paceFor,
  paceLine,
  resetCountdown,
  windowMsFor,
  sparkFor,
  sparkPath,
  type PaceMarker,
  type Reading,
  type Tone
} from '../../state/usageView'

const TONE_COLOR: Record<Tone, string> = {
  ok: 'var(--accent)',
  warn: 'var(--warning)',
  crit: 'var(--danger)'
}

export interface ReadoutProps {
  readings: Reading[]
  style: UsageStyle
  showReset: boolean
  /** Mark where an even spend of the window would be (5h and 7d only). */
  showPace: boolean
  real: RealUsage | null
  history: UsageSample[]
  now: number
  /** 'pill' = one inline row; 'widget' = fills its box and scales with it. */
  variant: 'pill' | 'widget'
}

function Spark({
  reading,
  real,
  history,
  now,
  w,
  h,
  showPace
}: {
  reading: Reading
  real: RealUsage | null
  history: UsageSample[]
  now: number
  w: number
  h: number
  showPace: boolean
}) {
  const data =
    reading.metric === 'fiveHour' || reading.metric === 'sevenDay'
      ? sparkFor(history, reading.metric, real, now)
      : null
  if (!data) return <span className="uv-collect" title="collecting data">collecting data</span>
  const d = sparkPath(data.points, data.from, data.to, w, h)
  const ms = windowMsFor(reading.metric)
  const ideal =
    showPace && ms !== null && reading.resetsAt !== null
      ? sparkPath(paceLine(reading.resetsAt, ms, data.from, now), data.from, data.to, w, h)
      : ''
  return (
    <svg className="uv-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {ideal && <path className="uv-spark__pace" d={ideal} fill="none" vectorEffect="non-scaling-stroke" />}
      <path d={d} fill="none" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Measures an element so the widget can size a ring to its cell. */
function useBox(): [(el: HTMLDivElement | null) => void, { w: number; h: number }] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [el])
  return [setEl, box]
}

function Item(p: ReadoutProps & { r: Reading }) {
  const { r, style, variant } = p
  const reset = p.showReset ? resetCountdown(r.resetsAt, p.now) : null
  const pace: PaceMarker | null = p.showPace ? paceFor(r, p.now) : null
  const numeric = r.known && r.pct !== null
  const graphable = r.metric === 'fiveHour' || r.metric === 'sevenDay'
  const viz = !numeric || (style === 'graph' && !graphable) ? 'percent' : style
  const [cellRef, cell] = useBox()
  const ringSize = Math.max(28, Math.min(cell.w, cell.h - 16, 140))
  return (
    <div className={`uv-item uv-item--${viz} uv--${r.tone}${r.known ? '' : ' uv--none'}`}>
      {viz === 'ring' && variant === 'widget' ? (
        <div className="uv-ringcell" ref={cellRef}>
          {cell.w > 0 && (
            <Ring
              pct={r.pct ?? 0}
              size={ringSize}
              stroke={Math.max(4, ringSize / 10)}
              color={TONE_COLOR[r.tone]}
              pace={pace?.pacePct}
            >
              <span className="uv-ring-num" style={{ fontSize: Math.max(11, ringSize / 3.4) }}>
                {r.text}
              </span>
            </Ring>
          )}
          <span className="uv-label">
            {r.label}
            {reset && <span className="uv-reset"> {reset}</span>}
          </span>
        </div>
      ) : (
        <>
          <span className="uv-label">{r.label}</span>
          {viz === 'ring' && (
            <Ring pct={r.pct ?? 0} size={16} stroke={3} color={TONE_COLOR[r.tone]} pace={pace?.pacePct} />
          )}
          {viz === 'bar' && (
            <span className={`uv-bar${pace ? ' uv-bar--pace' : ''}`}>
              <i style={{ width: `${Math.min(100, Math.max(0, r.pct ?? 0))}%` }} />
              {pace && <b className="uv-pace" style={{ left: `${pace.pacePct}%` }} />}
            </span>
          )}
          {viz === 'graph' && (
            <span className="uv-graphbox">
              <Spark reading={r} real={p.real} history={p.history} now={p.now} w={80} h={variant === 'pill' ? 14 : 40} showPace={p.showPace} />
            </span>
          )}
          <span className="uv-val">
            {r.text}
            {viz === 'percent' && p.showPace && windowMsFor(r.metric) !== null && r.known && (
              <span className={`uv-arrow uv-arrow--${pace?.state ?? 'even'}`} aria-hidden="true">
                {pace?.state === 'behind' ? '\u2193' : '\u2191'}
              </span>
            )}
          </span>
          {reset && <span className="uv-reset">{reset}</span>}
        </>
      )}
    </div>
  )
}

/** The chosen metrics in the chosen style. Used by the pill, the panel preview and
 * the floating widget, so all three always agree. */
export function UsageReadout(p: ReadoutProps) {
  if (hasNoData(p.readings)) {
    return <span className="uv-nodata">no data yet</span>
  }
  return (
    <div className={`uv uv--${p.variant} uv-style--${p.style}`} style={{ ['--n' as string]: p.readings.length }}>
      {p.readings.map((r) => (
        <Item key={r.metric} {...p} r={r} />
      ))}
    </div>
  )
}
