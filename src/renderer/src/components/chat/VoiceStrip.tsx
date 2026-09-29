import { useState } from 'react'
import type { VoiceSnapshot } from './voiceMachine'

/** Live line above the composer text box while Claude's voice mode listens. */
export function VoiceStrip({
  snapshot,
  onEnable,
  onDismissHint,
  canEnable
}: {
  snapshot: VoiceSnapshot
  onEnable: () => boolean
  onDismissHint: () => void
  canEnable: () => boolean
}): React.ReactElement | null {
  const [blocked, setBlocked] = useState(false)

  if (snapshot.hint && snapshot.phase === 'idle') {
    return (
      <div className="composer__voice composer__voice--hint" role="status">
        <span>Claude voice is off. Enable it?</span>
        <button
          className="btn btn--sm"
          title={
            blocked
              ? 'Claude must be idle with an empty input box to run /voice'
              : 'Runs /voice in this pane'
          }
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!canEnable()) {
              setBlocked(true)
              return
            }
            setBlocked(false)
            onEnable()
          }}
        >
          Enable
        </button>
        <button className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={onDismissHint}>
          Not now
        </button>
        {blocked && <span className="composer__voice-note">Claude must be idle with an empty input.</span>}
      </div>
    )
  }
  if (snapshot.phase === 'idle') return null

  const finishing = snapshot.phase === 'finishing'
  const listening =
    snapshot.phase === 'recording' && (snapshot.status === 'listening' || snapshot.status === 'rec')
  const label = finishing || snapshot.status === 'processing' ? 'Processing…' : listening ? 'Listening…' : 'Starting…'
  return (
    <div className="composer__voice" role="status" aria-live="polite">
      <span className="composer__voice-dot" aria-hidden="true" />
      <span className="composer__voice-label">{label}</span>
      {snapshot.interim && <span className="composer__voice-text">{snapshot.interim}</span>}
    </div>
  )
}
