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
  ESC_CLEAR_GAP_MS: 60,
  /**
   * tap mode: Claude treats a space burst that follows the start burst within its 120 ms burst
   * reset as a continuation and swallows it (verified in Claude Code 2.1.284: the start burst
   * ends at 100 ms, the counter resets 120 ms after the last space). A stop earlier than this
   * after the start would leave Claude recording, so it waits.
   */
  TAP_STOP_MIN_MS: 250,
  /** tap mode: REC still on screen this long after a stop burst means the stop was swallowed: cancel with Esc. */
  TAP_STUCK_REC_MS: 600,
  /** the pane must show no sign of Claude for this many polls in a row before we stop typing into it. */
  GONE_POLLS: 2
} as const

const ESC = '\x1b'
const CTRL_U_X2 = '\x15\x15'

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'finishing'

/**
 * What the strip should say after a recording that did not work:
 *   enable       voice is switched off in Claude's settings: offer to switch it on
 *   not-started  voice is on but Claude showed no indicator (login, mic permission, SoX)
 *   no-speech    Claude recorded but produced no text
 */
export type VoiceHint = 'none' | 'enable' | 'not-started' | 'no-speech'

export interface VoiceSnapshot {
  phase: VoicePhase
  status: VoiceStatus
  /** Live text from Claude's input box while listening. */
  interim: string
  hint: VoiceHint
}

export type StartResult = 'ok' | 'busy' | 'asking' | 'no-pane' | 'input-not-empty' | 'no-claude'

export interface VoiceDeps {
  /** Raw PTY write (never xterm paste). Returns false when the pane is gone. */
  write: (data: string) => boolean
  visibleText: () => string
  claudeState: () => ClaudeState
  settings: () => Pick<ClaudeVoiceSettings, 'enabled' | 'mode' | 'autoSubmit'>
  /** A fresh read of Claude's voice settings (null when it cannot be read). */
  readSettings: () => Promise<ClaudeVoiceSettings | null>
  /** Does this screen still show Claude (input box, working, asking, or a voice indicator)? */
  claudeHere: (visible: string) => boolean
  /** Send a slash command the way a prompt is sent (paste, then Enter). Resolves true once Enter is written. */
  sendCommand: (text: string) => Promise<boolean>
  onSnapshot: (s: VoiceSnapshot) => void
  /** The final transcript, to be inserted into the composer. */
  onTranscript: (text: string) => void
}

const IDLE_SNAPSHOT: VoiceSnapshot = { phase: 'idle', status: 'idle', interim: '', hint: 'none' }

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
  private hint: VoiceHint = 'none'
  private goneCount = 0
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
    this.hint = 'none'
    this.goneCount = 0
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
    if (this.mode === 'tap' && (!this.seen || Date.now() - this.startedAt < VOICE_TIMING.TAP_STOP_MIN_MS)) {
      // A stop burst before Claude showed REC would start it again, and one too soon after the
      // start burst is swallowed as a continuation: wait (the poll sends it).
      this.stopRequested = true
      return
    }
    this.beginFinish(true)
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
    if (this.hint === 'none') return
    this.hint = 'none'
    this.emit()
  }

  /** The "Enable it?" button is allowed only when Claude is idle and its input is empty. */
  canEnableVoice(): boolean {
    if (this.phase !== 'idle' || this.deps.claudeState() !== 'idle') return false
    return parseInputBox(this.deps.visibleText())?.text === ''
  }

  /**
   * Switch Claude's voice mode on. `/voice` alone TOGGLES, so it is only ever sent after a fresh
   * settings read says voice is off, and with an explicit mode (`/voice hold`) so it can never
   * turn voice off. When voice is already on, nothing is sent and the hint becomes the plain one.
   */
  async enableVoice(): Promise<boolean> {
    if (!this.canEnableVoice()) return false
    const s = await this.deps.readSettings()
    if (this.disposed) return false
    if (!s || s.enabled) {
      this.hint = 'not-started'
      this.emit()
      return false
    }
    if (!this.canEnableVoice()) return false
    const ok = await this.deps.sendCommand(`/voice ${s.mode}`)
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

  /**
   * `sendKeys` is true when the USER ended the recording (tap mode then types the stop burst). When
   * Claude ended it by itself (its own silence or length limit) no key is sent: a burst would start
   * a fresh recording, a hot mic that can even auto-submit.
   */
  private beginFinish(sendKeys: boolean): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }
    if (this.mode === 'tap' && sendKeys) this.burst()
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

    if (status === 'idle' && !this.deps.claudeHere(vis)) {
      // Claude quit (or another program took the pane): stop typing into it, and type nothing more.
      if (++this.goneCount >= VOICE_TIMING.GONE_POLLS) {
        this.abandon()
        return
      }
    } else {
      this.goneCount = 0
    }

    if (this.phase === 'starting' || this.phase === 'recording') {
      if (status !== 'idle') {
        this.seen = true
        this.idlePolls = 0
        if (this.phase === 'starting') this.phase = 'recording'
        if (this.mode === 'hold' && this.phase === 'recording' && status === 'processing') {
          // Claude released on its own (a stalled renderer): keep typing spaces and they pile up
          // in its input and start a second recording.
          this.beginFinish(false)
          return
        }
        if (this.stopRequested && now - this.startedAt >= VOICE_TIMING.TAP_STOP_MIN_MS) {
          this.stopRequested = false
          this.beginFinish(true)
          return
        }
      } else if (!this.seen) {
        if (now - this.startedAt >= VOICE_TIMING.START_TIMEOUT_MS) {
          this.voiceIsOff()
          return
        }
      } else if (++this.idlePolls >= VOICE_TIMING.LOST_POLLS) {
        // Claude ended the recording on its own (its own limit, or an error)
        this.beginFinish(false)
        return
      }
    } else if (this.phase === 'finishing') {
      if (status === 'processing') this.sawProcessing = true
      const waited = now - this.stoppedAt
      if (this.mode === 'tap' && status === 'rec' && waited >= VOICE_TIMING.TAP_STUCK_REC_MS) {
        // The stop burst never registered: Claude is still recording. Cancel it (Esc).
        this.cancel()
        return
      }
      const settled =
        status === 'idle' && (this.sawProcessing || waited >= VOICE_TIMING.NO_PROCESSING_GRACE_MS)
      if (settled || waited >= VOICE_TIMING.PROCESSING_TIMEOUT_MS) {
        this.complete()
        return
      }
    }
    this.emit()
  }

  /** Claude is no longer in front in this pane: end everything without a single further write. */
  private abandon(): void {
    this.clearTimers()
    this.phase = 'idle'
    this.reset()
    this.emit()
  }

  /** No voice indicator: stop, take the stray spaces back out, say why (voice off, or it did not start). */
  private voiceIsOff(): void {
    this.clearTimers()
    this.phase = 'idle'
    this.deps.write(CTRL_U_X2)
    this.reset()
    this.hint = this.deps.settings().enabled ? 'not-started' : 'enable'
    this.emit()
  }

  private complete(): void {
    this.clearTimers()
    const submittedByClaude = this.mode === 'tap' || this.autoSubmit
    const hold = this.stoppedAt - this.startedAt
    const neverSeen = !this.seen
    const sawProcessing = this.sawProcessing
    let transcript = ''
    if (neverSeen) {
      // Nothing was ever recorded: take our stray spaces back out of Claude's input.
      this.deps.write(submittedByClaude ? CTRL_U_X2 : clearInputKeys(this.lastLines))
    } else {
      // Even when Claude auto-submits, it does so only for 3 or more words: a shorter transcript
      // stays in its input box, and would be glued onto the next prompt. Read the box either way.
      const box = parseInputBox(this.deps.visibleText())
      transcript = box ? box.text : submittedByClaude ? '' : this.lastInterim
      if (!submittedByClaude || transcript) {
        this.deps.write(clearInputKeys(Math.max(this.lastLines, box?.lineCount ?? 1)))
      }
    }
    this.phase = 'idle'
    this.reset()
    if (neverSeen && hold >= VOICE_TIMING.MIN_HOLD_FOR_HINT_MS) {
      this.hint = this.deps.settings().enabled ? 'not-started' : 'enable'
    } else if (transcript) {
      this.deps.onTranscript(transcript)
    } else if (!neverSeen && !submittedByClaude && !sawProcessing) {
      this.hint = 'no-speech'
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
