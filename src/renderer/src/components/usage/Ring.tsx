import type { ReactNode } from 'react'

/** A circular progress ring. `pct` (0–100) is the filled portion; here it
 * represents the headroom LEFT, so a full ring = plenty left. */
export function Ring({
  pct,
  size = 116,
  stroke = 11,
  color = 'var(--accent)',
  pace,
  children
}: {
  pct: number
  size?: number
  stroke?: number
  color?: string
  /** Percent (0 to 100) where an even spend would be: draws a short tick across the ring. */
  pace?: number | null
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const off = c * (1 - clamped / 100)
  const mid = size / 2
  let tick: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (pace !== undefined && pace !== null) {
    const a = (Math.max(0, Math.min(100, pace)) / 100) * 2 * Math.PI - Math.PI / 2
    const reach = stroke / 2 + Math.max(1, stroke * 0.2)
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    tick = {
      x1: mid + (r - reach) * cos,
      y1: mid + (r - reach) * sin,
      x2: mid + (r + reach) * cos,
      y2: mid + (r + reach) * sin
    }
  }
  return (
    <div className="usage-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={tick ? { overflow: 'visible' } : undefined}>
        <circle
          className="usage-ring__track"
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          cx={mid}
          cy={mid}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          transform={`rotate(-90 ${mid} ${mid})`}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        {tick && (
          <line
            className="usage-ring__pace"
            {...tick}
            strokeWidth={Math.max(1.25, size / 45)}
            strokeLinecap="butt"
          />
        )}
      </svg>
      {children !== undefined && <div className="usage-ring__center">{children}</div>}
    </div>
  )
}
