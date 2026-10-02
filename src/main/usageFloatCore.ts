import { z } from 'zod'
import type { UsageFloatConfig } from '@shared/usageReal'
import type { Settings } from '@shared/types'
import type { UsageFloatView } from '@shared/ipc'
import { clampToAreas, type Area, type Box } from './overlayPlacement'

export const FLOAT_MIN_W = 140
export const FLOAT_MIN_H = 60
const MARGIN = 16

export const FLOAT_SIZE_PRESETS = {
  small: { w: 180, h: 80 },
  medium: { w: 260, h: 120 },
  large: { w: 360, h: 180 }
} as const

/** Top-right corner of a work area, the default home of the widget. */
export function defaultFloatBounds(area: Area, w: number, h: number): Box {
  const width = Math.min(Math.max(w, FLOAT_MIN_W), area.width)
  const height = Math.min(Math.max(h, FLOAT_MIN_H), area.height)
  return { x: area.x + area.width - width - MARGIN, y: area.y + MARGIN + 28, width, height }
}

/** Put a saved box back on a visible display: the size is limited to the display
 * and the position clamped so the whole window is on screen. With no saved
 * position (null) the default corner of the primary area is used. */
export function clampFloatBounds(
  saved: Pick<UsageFloatConfig, 'x' | 'y' | 'w' | 'h'>,
  areas: Area[],
  primary: Area
): Box {
  if (saved.x === null || saved.y === null) return defaultFloatBounds(primary, saved.w, saved.h)
  const target = areas.length ? areas : [primary]
  const w = Math.max(FLOAT_MIN_W, Math.round(saved.w))
  const h = Math.max(FLOAT_MIN_H, Math.round(saved.h))
  const raw: Box = { x: saved.x, y: saved.y, width: w, height: h }
  // The display the window overlaps most (else the nearest one) bounds its size.
  const home = target.reduce((best, a) => (overlap(raw, a) > overlap(raw, best) ? a : best), target[0])
  const width = Math.min(w, Math.max(FLOAT_MIN_W, home.width))
  const height = Math.min(h, Math.max(FLOAT_MIN_H, home.height))
  const p = clampToAreas({ x: saved.x, y: saved.y, width, height }, target)
  return { x: p.x, y: p.y, width, height }
}

function overlap(a: Box, b: Area): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Value equality for two boxes. */
export function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

const metric = z.enum(['fiveHour', 'sevenDay', 'context', 'cost'])
const style = z.enum(['percent', 'bar', 'ring', 'graph'])

/** What the widget itself may change about its config (never enabled, position or size). */
export const floatViewPatchSchema = z
  .object({
    show: z.array(metric).min(1).max(4).optional(),
    style: style.optional(),
    showReset: z.boolean().optional(),
    paceMarker: z.boolean().optional(),
    opacity: z.number().min(0.3).max(1).optional(),
    alwaysOnTop: z.boolean().optional()
  })
  .strict()

/** What the floating window is given: its config, the thresholds and the theme. */
export function usageFloatView(s: Settings): UsageFloatView {
  return { float: s.usage.float, warnAt: s.usage.pill.warnAt, critAt: s.usage.pill.critAt, theme: s.theme }
}
