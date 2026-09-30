import { X } from 'lucide-react'

/** Text is sitting in Claude's own input box that the composer does not have. */
export function StrayNotice({
  onMove,
  onClear
}: {
  onMove: () => void
  onClear: () => void
}): React.ReactElement {
  return (
    <div className="composer__stray" role="status">
      <span className="composer__stray-text">Claude&rsquo;s input has unsent text</span>
      <button className="btn btn--ghost btn--sm" onClick={onMove}>
        Move here
      </button>
      <button className="btn btn--ghost btn--sm" onClick={onClear}>
        <X size={12} /> Clear
      </button>
    </div>
  )
}
