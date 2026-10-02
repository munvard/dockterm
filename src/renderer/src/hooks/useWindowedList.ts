import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export interface WindowedRange {
  /** First row to render. */
  start: number
  /** One past the last row to render. */
  end: number
  /** Total pixel height of all rows (the spacer). */
  height: number
}

/**
 * Fixed-row-height windowing for a scroll container: only the rows near the
 * viewport are rendered, so a folder of 50,000 files costs the same as one of 50.
 * `overscan` rows are kept above and below so a fast wheel never shows a gap.
 */
export function useWindowedList(
  ref: RefObject<HTMLElement | null>,
  count: number,
  rowHeight: number,
  overscan = 8
): { range: WindowedRange; scrollToIndex: (i: number, align?: 'auto' | 'center') => void } {
  const [view, setView] = useState({ top: 0, h: 600 })
  const frame = useRef(0)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setView((v) => (v.top === el.scrollTop && v.h === el.clientHeight ? v : { top: el.scrollTop, h: el.clientHeight }))
  }, [ref])

  useLayoutEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      if (frame.current) return
      frame.current = requestAnimationFrame(() => {
        frame.current = 0
        measure()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [ref, measure])

  useEffect(() => {
    // The list shrank under the scroll position (a filter, a collapse): clamp.
    const el = ref.current
    if (!el) return
    const max = Math.max(0, count * rowHeight - el.clientHeight)
    if (el.scrollTop > max) el.scrollTop = max
  }, [count, rowHeight, ref])

  const start = Math.max(0, Math.floor(view.top / rowHeight) - overscan)
  const end = Math.min(count, Math.ceil((view.top + view.h) / rowHeight) + overscan)

  const scrollToIndex = useCallback(
    (i: number, align: 'auto' | 'center' = 'auto') => {
      const el = ref.current
      if (!el) return
      const top = i * rowHeight
      if (align === 'center') {
        el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowHeight / 2)
        return
      }
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight
    },
    [ref, rowHeight]
  )

  return { range: { start, end, height: count * rowHeight }, scrollToIndex }
}
