import { createPortal } from 'react-dom'
import { HistoryRail } from './HistoryRail'
import { useHistoryFloatStore } from '../../state/useHistoryFloatStore'
import { useDragResize } from '../common/useDragResize'
import { ResizeHandles } from '../common/ResizeHandles'

/** The checkpoints rail in a floating, movable + resizable card (vs the docked
 * side panel). Toggled from the rail's header; defaults to docked. */
export function HistoryFloating({
  cwd,
  leafId
}: {
  cwd: string | null
  leafId: string | null
}): React.ReactElement {
  const pos = useHistoryFloatStore((s) => s.pos)
  const size = useHistoryFloatStore((s) => s.size)
  const { ref, style, onHeaderMouseDown, onResizeMouseDown } = useDragResize({
    pos,
    size,
    defaultSize: { w: 300, h: 480 },
    onMove: useHistoryFloatStore.getState().setPos,
    onResize: useHistoryFloatStore.getState().setSize
  })
  return createPortal(
    <div ref={ref} className="hist-float" style={style}>
      <HistoryRail cwd={cwd} leafId={leafId} onHeaderMouseDown={onHeaderMouseDown} />
      <ResizeHandles onResize={onResizeMouseDown} />
    </div>,
    document.body
  )
}
