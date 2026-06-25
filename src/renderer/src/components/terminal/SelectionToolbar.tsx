import { Sparkles, Copy } from 'lucide-react'
import type { Pt } from './terminalSelection'

/**
 * The floating action toolbar shown when terminal text is selected. "Send to
 * Claude" is the star (drops the selection into the pane's prompt as a reference);
 * Copy is there for completeness — native ⌘C / Ctrl+Shift+C still works.
 */
export function SelectionToolbar({
  pos,
  onSend,
  onCopy
}: {
  pos: Pt
  onSend: () => void
  onCopy: () => void
}) {
  return (
    <div
      className="sel-toolbar"
      style={{ left: pos.x, top: pos.y }}
      // Don't let clicks clear the terminal selection before the action runs.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button className="sel-toolbar__send" onClick={onSend} title="Send the selection to Claude">
        <Sparkles size={13} />
        Send to Claude
      </button>
      <button className="sel-toolbar__copy" onClick={onCopy} title="Copy">
        <Copy size={13} />
      </button>
    </div>
  )
}
