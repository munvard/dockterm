import { useEffect, useState } from 'react'
import type { RealUsage, UsageStyle } from '@shared/usageReal'
import type { UsageSample } from '@shared/usageHistory'
import { Ring } from './Ring'
import {
  hasNoData,
  resetCountdown,
  sparkFor,
  sparkPath,
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
  h
}: {
  reading: Reading
  real: RealUsage | null
  history: UsageSample[]
  now: number
  w: number
  h: number
}) {
  const data =
    reading.metric === 'fiveHour' || reading.metric === 'sevenDay'
      ? sparkFor(history, reading.metric, real, now)
      : null
  if (!data) return <span className="uv-collect" title="collecting data">collecting data</span>
  const d = sparkPath(data.points, data.from, data.to, w, h)
  return (
    <svg className="uv-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
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
            <Ring pct={r.pct ?? 0} size={ringSize} stroke={Math.max(4, ringSize / 10)} color={TONE_COLOR[r.tone]}>
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
            <Ring pct={r.pct ?? 0} size={16} stroke={3} color={TONE_COLOR[r.tone]} />
          )}
          {viz === 'bar' && (
            <span className="uv-bar">
              <i style={{ width: `${Math.min(100, Math.max(0, r.pct ?? 0))}%` }} />
            </span>
          )}
          {viz === 'graph' && (
            <span className="uv-graphbox">
              <Spark reading={r} real={p.real} history={p.history} now={p.now} w={80} h={variant === 'pill' ? 14 : 40} />
            </span>
          )}
          <span className="uv-val">{r.text}</span>
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
