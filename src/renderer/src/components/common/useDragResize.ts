import { useRef } from 'react'

export interface Pt {
  x: number
  y: number
}
export interface Box {
  w: number
  h: number
}
/** Which corner a resize is dragged from. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se'

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/**
 * Drag-to-move + resize-from-corner for a floating, portal'd panel. Position and
 * size are owned by the caller (a store), so they persist across re-renders.
 *
 * - When `pos` is null the panel anchors to the bottom-right (so it needs no
 *   measured height); the first drag OR resize converts it to absolute left/top.
 * - When `size` is null the panel sizes to its content up to `defaultSize.h`;
 *   the first resize pins an explicit width/height.
 */
export function useDragResize(opts: {
  pos: Pt | null
  size: Box | null
  defaultSize: Box
  min?: Box
  onMove: (p: Pt) => void
  onResize: (b: Box) => void
}): {
  ref: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  onHeaderMouseDown: (e: React.MouseEvent) => void
  onResizeMouseDown: (e: React.MouseEvent, corner: Corner) => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const min = opts.min ?? { w: 240, h: 160 }

  const onHeaderMouseDown = (e: React.MouseEvent): void => {
    // Don't start a drag from a button in the header (close, toggles…).
    if ((e.target as HTMLElement).closest('button')) return
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: MouseEvent): void => {
      const x = clamp(rect.left + (ev.clientX - sx), 4, window.innerWidth - rect.width - 4)
      const y = clamp(rect.top + (ev.clientY - sy), 4, window.innerHeight - rect.height - 4)
      opts.onMove({ x, y })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const onResizeMouseDown = (e: React.MouseEvent, corner: Corner): void => {
    e.stopPropagation()
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const baseLeft = rect.left
    const baseTop = rect.top
    const baseW = rect.width
    const baseH = rect.height
    // Anchor to absolute left/top so west/north corners can move the origin.
    if (!opts.pos) opts.onMove({ x: baseLeft, y: baseTop })
    const sx = e.clientX
    const sy = e.clientY
    const move = (ev: MouseEvent): void => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      let left = baseLeft
      let top = baseTop
      let w = baseW
      let h = baseH
      if (corner.includes('e')) w = clamp(baseW + dx, min.w, window.innerWidth - baseLeft - 4)
      if (corner.includes('s')) h = clamp(baseH + dy, min.h, window.innerHeight - baseTop - 4)
      if (corner.includes('w')) {
        const right = baseLeft + baseW
        left = clamp(baseLeft + dx, 4, right - min.w)
        w = right - left
      }
      if (corner.includes('n')) {
        const bottom = baseTop + baseH
        top = clamp(baseTop + dy, 4, bottom - min.h)
        h = bottom - top
      }
      opts.onMove({ x: left, y: top })
      opts.onResize({ w, h })
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const style: React.CSSProperties = {
    ...(opts.pos ? { left: opts.pos.x, top: opts.pos.y } : { right: 16, bottom: 16 }),
    width: opts.size?.w ?? opts.defaultSize.w,
    ...(opts.size ? { height: opts.size.h } : { maxHeight: opts.defaultSize.h })
  }

  return { ref, style, onHeaderMouseDown, onResizeMouseDown }
}
