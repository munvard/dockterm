import { createPortal } from 'react-dom'
import { ReadingView } from './ReadingView'
import { useReadingFloatStore } from '../../state/useReadingFloatStore'
import { useDragResize } from '../common/useDragResize'
import { ResizeHandles } from '../common/ResizeHandles'

export function ReadingFloating({
  cwd,
  leafId
}: {
  cwd: string | null
  leafId: string | null
}): React.ReactElement {
  const pos = useReadingFloatStore((s) => s.pos)
  const size = useReadingFloatStore((s) => s.size)
  const { ref, style, onHeaderMouseDown, onResizeMouseDown } = useDragResize({
    pos,
    size,
    defaultSize: { w: 520, h: 640 },
    min: { w: 320, h: 240 },
    onMove: useReadingFloatStore.getState().setPos,
    onResize: useReadingFloatStore.getState().setSize
  })
  return createPortal(
    <div ref={ref} className="reading-float" style={style}>
      <ReadingView cwd={cwd} leafId={leafId} onHeaderMouseDown={onHeaderMouseDown} />
      <ResizeHandles onResize={onResizeMouseDown} />
    </div>,
    document.body
  )
}
