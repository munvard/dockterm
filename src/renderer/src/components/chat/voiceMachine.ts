import type { ClaudeVoiceSettings } from '@shared/types'
import type { ClaudeState } from '../terminal/claudeStatus'
import { clearInputKeys, detectVoiceStatus, parseInputBox, type VoiceStatus } from './claudeVoice'

/**
 * Drives Claude Code's own voice mode through a pane's PTY. DockTerm records
 * nothing: it types the keys Claude listens for (a stream of spaces) and reads
 * what Claude draws. Timings were verified against Claude Code 2.1.283.
 *
 * Phases:
 *   idle       nothing going on
 *   starting   keys sent, no voice indicator on screen yet
 *   recording  Claude shows warming / listening / REC
 *   finishing  we stopped; waiting for Claude to finish transcribing
 */
export const VOICE_TIMING = {
  /** hold mode: one space this often keeps Claude recording (its release gap is ~120 ms). */
  HOLD_STREAM_MS: 40,
  /** tap mode: a burst of this many spaces starts or stops, one every TAP_GAP_MS. */
  TAP_BURST: 6,
  TAP_GAP_MS: 20,
  /** how often the pane's visible text is read. */
  POLL_MS: 100,
  /** no voice indicator this long after starting means Claude's voice is off. */
  START_TIMEOUT_MS: 1500,
  /** longest we wait for Claude to finish transcribing after a stop. */
  PROCESSING_TIMEOUT_MS: 8000,
  /** after a stop with no "processing" ever seen: how long an idle screen must hold. */
  NO_PROCESSING_GRACE_MS: 400,
  /** once recording, this many idle polls in a row mean Claude ended it by itself. */
  LOST_POLLS: 2,
  /** a never-seen indicator after a stop only counts as "voice is off" for a hold this long. */
  MIN_HOLD_FOR_HINT_MS: 700,
  /** ESC and the following Ctrl+U must be separate reads, or Claude reads Alt+Ctrl+U. */
  ESC_CLEAR_GAP_MS: 60
} as const

const ESC = '\x1b'
const CTRL_U_X2 = '\x15\x15'

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'finishing'

export interface VoiceSnapshot {
  phase: VoicePhase
  status: VoiceStatus
  /** Live text from Claude's input box while listening. */
  interim: string
  /** Show "Claude voice is off. Enable it?" */
  hint: boolean
}

export type StartResult = 'ok' | 'busy' | 'asking' | 'no-pane' | 'input-not-empty'

export interface VoiceDeps {
  /** Raw PTY write (never xterm paste). Returns false when the pane is gone. */
  write: (data: string) => boolean
  visibleText: () => string
  claudeState: () => ClaudeState
  settings: () => Pick<ClaudeVoiceSettings, 'mode' | 'autoSubmit'>
  /** Send a slash command the way a prompt is sent (paste, then Enter). */
  sendCommand: (text: string) => boolean
  onSnapshot: (s: VoiceSnapshot) => void
  /** The final transcript, to be inserted into the composer. */
  onTranscript: (text: string) => void
}

const IDLE_SNAPSHOT: VoiceSnapshot = { phase: 'idle', status: 'idle', interim: '', hint: false }

export class VoiceMachine {
  private snap: VoiceSnapshot = IDLE_SNAPSHOT
  private phase: VoicePhase = 'idle'
  private mode: 'hold' | 'tap' = 'hold'
  private autoSubmit = false
  private startedAt = 0
  private stoppedAt = 0
  private seen = false
  private stopRequested = false
  private sawProcessing = false
  private idlePolls = 0
  private lastStatus: VoiceStatus = 'idle'
  private lastLines = 1
  private lastInterim = ''
  private hint = false
  private disposed = false

  private streamTimer: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private burstTimers = new Set<ReturnType<typeof setTimeout>>()
  private cleanupTimer: ReturnType<typeof setTimeout> | null = null
  private pendingClear = ''

  constructor(private deps: VoiceDeps) {}

  getSnapshot(): VoiceSnapshot {
    return this.snap
  }

  isActive(): boolean {
    return this.phase !== 'idle'
  }

  /** Begin recording. Nothing is typed unless Claude is idle or working (not asking). */
  start(): StartResult {
    if (this.disposed) return 'no-pane'
    if (this.phase !== 'idle') return 'busy'
    this.flushCleanup()
    if (this.deps.claudeState() === 'asking') return 'asking'
    const { mode, autoSubmit } = this.deps.settings()
    if (mode === 'tap') {
      // tap mode only works with an empty Claude input
      const box = parseInputBox(this.deps.visibleText())
      if (box && box.text !== '') return 'input-not-empty'
    }
    this.mode = mode
    this.autoSubmit = autoSubmit
    this.hint = false
    this.seen = false
    this.stopRequested = false
    this.sawProcessing = false
    this.idlePolls = 0
    this.lastStatus = 'idle'
    this.lastLines = 1
    this.lastInterim = ''
    this.startedAt = Date.now()
    this.phase = 'starting'

    if (mode === 'hold') {
      if (!this.deps.write(' ')) {
        this.phase = 'idle'
        return 'no-pane'
      }
      this.streamTimer = setInterval(() => {
        this.deps.write(' ')
      }, VOICE_TIMING.HOLD_STREAM_MS)
    } else if (!this.burst()) {
      this.phase = 'idle'
      return 'no-pane'
    }
    this.pollTimer = setInterval(() => this.poll(), VOICE_TIMING.POLL_MS)
    this.emit()
    return 'ok'
  }

  /** Stop recording (key released, second click, second tap burst). */
  stop(): void {
    if (this.phase !== 'starting' && this.phase !== 'recording') return
    if (this.mode === 'tap' && !this.seen) {
      // A stop burst before Claude showed REC would start it again: wait for the indicator.
      this.stopRequested = true
      return
    }
    this.beginFinish()
  }

  /** Esc, unmount, pane close, chat-mode toggle: stop everything, clear Claude's input. */
  cancel(): void {
    if (this.phase === 'idle') return
    this.clearTimers()
    const claudeRecording = this.seen && this.lastStatus !== 'idle'
    const clear = clearInputKeys(this.lastLines)
    this.phase = 'idle'
    if (claudeRecording) {
      // Esc cancels Claude's recording. Only sent while Claude shows a voice
      // indicator: a bare Esc would otherwise interrupt a working turn.
      this.deps.write(ESC)
      this.pendingClear = clear
      this.cleanupTimer = setTimeout(() => this.flushCleanup(), VOICE_TIMING.ESC_CLEAR_GAP_MS)
    } else {
      this.deps.write(clear)
    }
    this.reset()
    this.emit()
  }

  /** Unmount: same as cancel, and never notify the UI again. */
  dispose(): void {
    this.disposed = true
    this.cancel()
  }

  dismissHint(): void {
    if (!this.hint) return
    this.hint = false
    this.emit()
  }

  /** The "Enable it?" button is allowed only when Claude is idle and its input is empty. */
  canEnableVoice(): boolean {
    if (this.phase !== 'idle' || this.deps.claudeState() !== 'idle') return false
    return parseInputBox(this.deps.visibleText())?.text === ''
  }

  enableVoice(): boolean {
    if (!this.canEnableVoice()) return false
    const ok = this.deps.sendCommand('/voice')
    if (ok) this.dismissHint()
    return ok
  }

  // -- internals -----------------------------------------------------------

  /** The Ctrl+U that follows a cancel's Esc (sent now if a new start beats the timer). */
  private flushCleanup(): void {
    if (!this.cleanupTimer) return
    clearTimeout(this.cleanupTimer)
    this.cleanupTimer = null
    this.deps.write(this.pendingClear)
  }

  private burst(): boolean {
    if (!this.deps.write(' ')) return false
    for (let i = 1; i < VOICE_TIMING.TAP_BURST; i++) {
      const t = setTimeout(() => {
        this.burstTimers.delete(t)
        this.deps.write(' ')
      }, i * VOICE_TIMING.TAP_GAP_MS)
      this.burstTimers.add(t)
    }
    return true
  }

  private beginFinish(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }
    if (this.mode === 'tap') this.burst()
    this.phase = 'finishing'
    this.stoppedAt = Date.now()
    this.emit()
  }

  private poll(): void {
    const vis = this.deps.visibleText()
    const status = detectVoiceStatus(vis)
    const box = parseInputBox(vis)
    this.lastStatus = status
    if (box) {
      this.lastLines = Math.max(this.lastLines, box.lineCount)
      this.lastInterim = box.text
    }
    const now = Date.now()

    if (this.phase === 'starting' || this.phase === 'recording') {
      if (status !== 'idle') {
        this.seen = true
        this.idlePolls = 0
        if (this.phase === 'starting') this.phase = 'recording'
        if (this.stopRequested) {
          this.stopRequested = false
          this.beginFinish()
          return
        }
      } else if (!this.seen) {
        if (now - this.startedAt >= VOICE_TIMING.START_TIMEOUT_MS) {
          this.voiceIsOff()
          return
        }
      } else if (++this.idlePolls >= VOICE_TIMING.LOST_POLLS) {
        // Claude ended the recording on its own (its own limit, or an error)
        this.beginFinish()
        return
      }
    } else if (this.phase === 'finishing') {
      if (status === 'processing') this.sawProcessing = true
      const waited = now - this.stoppedAt
      const settled =
        status === 'idle' && (this.sawProcessing || waited >= VOICE_TIMING.NO_PROCESSING_GRACE_MS)
      if (settled || waited >= VOICE_TIMING.PROCESSING_TIMEOUT_MS) {
        this.complete()
        return
      }
    }
    this.emit()
  }

  /** No voice indicator: stop, take the stray spaces back out, offer to enable voice. */
  private voiceIsOff(): void {
    this.clearTimers()
    this.phase = 'idle'
    this.deps.write(CTRL_U_X2)
    this.reset()
    this.hint = true
    this.emit()
  }

  private complete(): void {
    this.clearTimers()
    const submittedByClaude = this.mode === 'tap' || this.autoSubmit
    const hold = this.stoppedAt - this.startedAt
    const neverSeen = !this.seen
    let transcript = ''
    let lines = this.lastLines
    if (!submittedByClaude) {
      const box = parseInputBox(this.deps.visibleText())
      transcript = box ? box.text : this.lastInterim
      lines = Math.max(lines, box?.lineCount ?? 1)
      this.deps.write(clearInputKeys(lines))
    } else if (neverSeen) {
      this.deps.write(CTRL_U_X2)
    }
    this.phase = 'idle'
    this.reset()
    if (neverSeen && hold >= VOICE_TIMING.MIN_HOLD_FOR_HINT_MS) {
      this.hint = true
    } else if (transcript) {
      this.deps.onTranscript(transcript)
    }
    this.emit()
  }

  private reset(): void {
    this.seen = false
    this.stopRequested = false
    this.sawProcessing = false
    this.idlePolls = 0
    this.lastStatus = 'idle'
    this.lastLines = 1
    this.lastInterim = ''
  }

  private clearTimers(): void {
    if (this.streamTimer) clearInterval(this.streamTimer)
    if (this.pollTimer) clearInterval(this.pollTimer)
    for (const t of this.burstTimers) clearTimeout(t)
    this.burstTimers.clear()
    this.streamTimer = null
    this.pollTimer = null
  }

  private emit(): void {
    const next: VoiceSnapshot = {
      phase: this.phase,
      status: this.phase === 'idle' ? 'idle' : this.lastStatus,
      interim: this.phase === 'idle' ? '' : this.lastInterim,
      hint: this.hint
    }
    const prev = this.snap
    if (
      prev.phase === next.phase &&
      prev.status === next.status &&
      prev.interim === next.interim &&
      prev.hint === next.hint
    )
      return
    this.snap = next
    if (!this.disposed) this.deps.onSnapshot(next)
  }
}
