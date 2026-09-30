import { useState } from 'react'
import { k } from '../../hooks/keys'
import type { VoiceSnapshot } from './voiceMachine'

/** Live line above the composer text box while Claude's voice mode listens. */
export function VoiceStrip({
  snapshot,
  onEnable,
  onDismissHint,
  canEnable
}: {
  snapshot: VoiceSnapshot
  onEnable: () => Promise<boolean> | boolean
  onDismissHint: () => void
  canEnable: () => boolean
}): React.ReactElement | null {
  const [blocked, setBlocked] = useState(false)

  if (snapshot.hint !== 'none' && snapshot.phase === 'idle' && snapshot.hint !== 'enable') {
    const text =
      snapshot.hint === 'claude-error'
        ? `Claude voice: ${snapshot.message}`
        : snapshot.hint === 'no-speech'
        ? `No speech captured. See the terminal (${k('⌘R', 'Ctrl+Shift+R')}) for Claude’s message.`
        : `Claude voice did not start. It needs a claude.ai login and microphone permission (Linux also needs SoX). See the terminal (${k('⌘R', 'Ctrl+Shift+R')}) for Claude’s message.`
    return (
      <div className="composer__voice composer__voice--hint" role="status">
        <span>{text}</span>
        <button className="btn btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={onDismissHint}>
          Dismiss
        </button>
      </div>
    )
  }
  if (snapshot.hint === 'enable' && snapshot.phase === 'idle') {
    return (
      <div className="composer__voice composer__voice--hint" role="status">
        <span>Claude voice is off. Enable it?</span>
        <button
          className="btn btn--sm"
          title={
            blocked
              ? 'Claude must be idle with an empty input box to run /voice'
              : 'Runs /voice in this pane to switch voice on'
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
