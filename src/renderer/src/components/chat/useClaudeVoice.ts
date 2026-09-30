import { useCallback, useEffect, useRef, useState } from 'react'
import { setVoiceActive } from '../../state/launchTracker'
import { paneWriters } from '../../state/paneWriters'
import { sendPrompt } from '../../state/sendPrompt'
import { useMunuStore } from '../../state/useMunuStore'
import { useToastStore } from '../../state/useToastStore'
import { paneVisibleText } from '../terminal/terminalPool'
import { paneClaudeForeground } from '../terminal/paneClaudeActive'
import { claudeOnScreen } from '../terminal/paneLiveness'
import { detectVoiceStatus } from './claudeVoice'
import { VoiceMachine, type StartResult, type VoiceSnapshot } from './voiceMachine'

const IDLE: VoiceSnapshot = { phase: 'idle', status: 'idle', interim: '', hint: 'none', message: '' }

const START_FAILURES: Partial<Record<StartResult, string>> = {
  asking: 'Answer Claude’s question first, then try voice again.',
  'input-not-empty': 'Claude’s own input box is not empty. Clear it in the terminal, then try again.',
  'no-pane': 'Could not reach this terminal.',
  'no-claude': 'Claude is not running in this pane, so voice is off.'
}

export interface ClaudeVoice {
  snapshot: VoiceSnapshot
  /** Begin recording (reads Claude's voice settings first). */
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
  dismissHint: () => void
  enableVoice: () => Promise<boolean>
  canEnableVoice: () => boolean
  /** Latest phase, readable synchronously from event handlers. */
  isActive: () => boolean
}

/**
 * Speech-to-text through Claude Code's own voice mode in this pane's PTY.
 * DockTerm records no audio and calls no API. Unmounting (pane close, chat/terminal
 * toggle) cancels cleanly and leaves no timer behind.
 */
export function useClaudeVoice(leafId: string, onTranscript: (text: string) => void): ClaudeVoice {
  const [snapshot, setSnapshot] = useState<VoiceSnapshot>(IDLE)
  const machine = useRef<VoiceMachine | null>(null)
  const settings = useRef<{ enabled: boolean; mode: 'hold' | 'tap'; autoSubmit: boolean }>({
    // Unknown until read: assume ON, so a failed read can never lead to a toggling /voice.
    enabled: true,
    mode: 'hold',
    autoSubmit: false
  })
  const transcriptRef = useRef(onTranscript)
  transcriptRef.current = onTranscript
  // Bumped by stop/cancel so a start still waiting on the settings read gives up.
  const startToken = useRef(0)

  useEffect(() => {
    const m = new VoiceMachine({
      write: (d) => paneWriters.write(leafId, d),
      visibleText: () => paneVisibleText(leafId),
      claudeState: () => useMunuStore.getState().panes[leafId]?.state ?? 'idle',
      settings: () => settings.current,
      readSettings: async () => {
        const r = await window.dockterm.invoke('claude:voiceSettings', undefined)
        if (!r.ok) return null
        settings.current = { enabled: r.value.enabled, mode: r.value.mode, autoSubmit: r.value.autoSubmit }
        return r.value
      },
      claudeHere: (vis) => claudeOnScreen(vis) || detectVoiceStatus(vis) !== 'idle',
      sendCommand: (t) => sendPrompt(leafId, t, () => paneClaudeForeground(leafId)),
      onSnapshot: (s) => {
        setVoiceActive(leafId, s.phase !== 'idle')
        setSnapshot(s)
      },
      onTranscript: (t) => transcriptRef.current(t)
    })
    machine.current = m
    return () => {
      startToken.current++
      m.dispose()
      setVoiceActive(leafId, false)
      machine.current = null
    }
  }, [leafId])

  const start = useCallback(async (): Promise<void> => {
    const m = machine.current
    if (!m || m.isActive()) return
    const token = ++startToken.current
    const r = await window.dockterm.invoke('claude:voiceSettings', undefined)
    if (r.ok) settings.current = { enabled: r.value.enabled, mode: r.value.mode, autoSubmit: r.value.autoSubmit }
    // Fail closed: only type into a pane where Claude is really the foreground program.
    const inFront = await paneClaudeForeground(leafId)
    if (token !== startToken.current || machine.current !== m) return
    const res = inFront ? m.start() : 'no-claude'
    const msg = START_FAILURES[res]
    if (msg) useToastStore.getState().push(msg, 'warning')
  }, [])

  const stop = useCallback((): void => {
    startToken.current++
    machine.current?.stop()
  }, [])

  const cancel = useCallback((): void => {
    startToken.current++
    machine.current?.cancel()
  }, [])

  return {
    snapshot,
    start,
    stop,
    cancel,
    dismissHint: useCallback(() => machine.current?.dismissHint(), []),
    enableVoice: useCallback(() => machine.current?.enableVoice() ?? Promise.resolve(false), []),
    canEnableVoice: useCallback(() => machine.current?.canEnableVoice() ?? false, []),
    isActive: useCallback(() => machine.current?.isActive() ?? false, [])
  }
}
