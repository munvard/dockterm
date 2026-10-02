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

/** A pinned munu's anchor: the x of its centre and the y of its top. */
export interface MunuAnchor {
  cx: number
  y: number
}

/** The anchor stored in settings. `munu.position` is the top-left of a box of the
 * overlay's starting width centred on munu, so it does not depend on how wide
 * munu's content was when it was saved. */
export function anchorFromSaved(pos: { x: number; y: number }, startWidth: number): MunuAnchor {
  return { cx: pos.x + startWidth / 2, y: pos.y }
}

/** The inverse of anchorFromSaved: the position to store for `a`. */
export function savedFromAnchor(a: MunuAnchor, startWidth: number): { x: number; y: number } {
  return { x: Math.round(a.cx - startWidth / 2), y: Math.round(a.y) }
}

/** munu's box at size `w`×`h` with its centre on the anchor, so a change of width
 * (size slider, popup, agent swarm) never moves munu sideways. */
export function boxAtAnchor(a: MunuAnchor, w: number, h: number): Box {
  return { x: Math.round(a.cx - w / 2), y: Math.round(a.y), width: w, height: h }
}

/** True when the overlay is drawn as a fixed canvas with munu placed inside it
 * (Windows and macOS), instead of resizing the real window to munu's size. */
export function usesCanvas(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** The screen rect the canvas window covers on `display`. macOS spans the whole
 * display (munu rests over the notch, above the work area); Windows spans the
 * work area so the canvas never covers the taskbar. */
export function canvasAreaFor(platform: string, display: { bounds: Area; workArea: Area }): Area {
  const a = platform === 'darwin' ? display.bounds : display.workArea
  return { x: a.x, y: a.y, width: a.width, height: a.height }
}

/** The part of munu that must catch clicks (its island plus popup or card),
 * in the overlay renderer's own coordinates, relative to munu's box top-left. */
export type HitRegion = Box

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** A hit region from untrusted numbers, or null when it is empty or malformed. */
export function normalizeHit(h: Partial<HitRegion> | null | undefined): HitRegion | null {
  if (!h || !finite(h.x) || !finite(h.y) || !finite(h.width) || !finite(h.height)) return null
  if (h.width < 1 || h.height < 1) return null
  return { x: h.x, y: h.y, width: h.width, height: h.height }
}

/** Where a hit region sits on screen when munu's box is at `box`. */
export function hitRectOnScreen(box: Box, hit: HitRegion): Box {
  return { x: box.x + hit.x, y: box.y + hit.y, width: hit.width, height: hit.height }
}

/** Grow an enter zone only a little, but keep a wider one while already inside,
 * so a cursor resting on an edge does not flicker between clickable and click-through. */
export const HIT_ENTER_PAD = 3
export const HIT_LEAVE_PAD = 10

/** Whether the cursor counts as over munu, with hysteresis around the edge. */
export function cursorOverHit(
  cursor: { x: number; y: number },
  rect: Box,
  wasInside: boolean,
  enterPad = HIT_ENTER_PAD,
  leavePad = HIT_LEAVE_PAD
): boolean {
  return pointNearBox(cursor, rect, wasInside ? leavePad : enterPad)
}
