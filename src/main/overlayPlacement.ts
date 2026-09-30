export interface Box {
  x: number
  y: number
  width: number
  height: number
}
export interface Area {
  x: number
  y: number
  width: number
  height: number
}

const centerX = (b: { x: number; width: number }): number => b.x + b.width / 2
const centerY = (b: { y: number; height: number }): number => b.y + b.height / 2

/** Clamp `box`'s top-left so the box stays fully within the nearest work area. */
export function clampToAreas(box: Box, areas: Area[]): { x: number; y: number } {
  if (areas.length === 0) return { x: Math.round(box.x), y: Math.round(box.y) }
  // Choose the area whose center is closest to the box center.
  const bx = centerX(box)
  const by = centerY(box)
  let best = areas[0]
  let bestDist = Infinity
  for (const a of areas) {
    const dx = centerX(a) - bx
    const dy = centerY(a) - by
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = a
    }
  }
  const maxX = best.x + best.width - box.width
  const maxY = best.y + best.height - box.height
  const x = Math.round(Math.min(Math.max(box.x, best.x), Math.max(best.x, maxX)))
  const y = Math.round(Math.min(Math.max(box.y, best.y), Math.max(best.y, maxY)))
  return { x, y }
}

/** True when two rects are identical. */
export function sameRect(a: Area | null, b: Area): boolean {
  return !!a && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

/** Where `box` (screen coordinates) sits inside `canvas`, in the canvas window's
 * own coordinates. */
export function frameInCanvas(box: Box, canvas: Area): Box {
  return { x: box.x - canvas.x, y: box.y - canvas.y, width: box.width, height: box.height }
}

/** True when point `p` lies inside `box` grown by `margin` on every side. */
export function pointNearBox(p: { x: number; y: number }, box: Box, margin: number): boolean {
  return (
    p.x >= box.x - margin &&
    p.x <= box.x + box.width + margin &&
    p.y >= box.y - margin &&
    p.y <= box.y + box.height + margin
  )
}
