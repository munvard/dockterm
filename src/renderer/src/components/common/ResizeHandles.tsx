import type { Corner } from './useDragResize'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

/** The four corner grab-zones for resizing a floating panel. */
export function ResizeHandles({
  onResize
}: {
  onResize: (e: React.MouseEvent, corner: Corner) => void
}): React.ReactElement {
  return (
    <>
      {CORNERS.map((c) => (
        <div
          key={c}
          className={`floatpanel-resize floatpanel-resize--${c}`}
          onMouseDown={(e) => onResize(e, c)}
          aria-hidden
        />
      ))}
    </>
  )
}
