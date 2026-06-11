import { PTY } from '@shared/constants'

/**
 * Pure flow-control + batching state for one PTY session (no timers, no node-pty
 * — fully unit-testable). The owning ptyService drives it with real timers and
 * calls pty.pause()/resume() based on the booleans returned here.
 *
 * Batching: chunks accumulate until `push` reports the byte threshold is crossed
 * (or the owner's flush timer fires), then `drain` empties the buffer in one write.
 *
 * Backpressure: the owner reports bytes handed to the renderer via `onSent` and
 * bytes the renderer confirms via `onAck`. When unacknowledged bytes cross the
 * high-water mark the PTY pauses; once they fall back under the low-water mark it
 * resumes (the xterm.js documented flow-control pattern).
 */
export class PtyFlow {
  private buffer: string[] = []
  private bufferedBytes = 0
  private unacked = 0
  private paused = false

  /** Append a chunk. Returns true if buffered bytes now meet the flush threshold. */
  push(chunk: string): boolean {
    this.buffer.push(chunk)
    this.bufferedBytes += Buffer.byteLength(chunk)
    return this.bufferedBytes >= PTY.FLUSH_BYTES
  }

  get hasBuffered(): boolean {
    return this.buffer.length > 0
  }

  /** Concatenate and clear the buffer for a single renderer write. */
  drain(): string {
    if (this.buffer.length === 0) return ''
    const out = this.buffer.join('')
    this.buffer = []
    this.bufferedBytes = 0
    return out
  }

  /** Record bytes sent to the renderer. Returns true if the PTY should pause now. */
  onSent(bytes: number): boolean {
    this.unacked += bytes
    if (!this.paused && this.unacked >= PTY.HIGH_WATER) {
      this.paused = true
      return true
    }
    return false
  }

  /** Record bytes acknowledged by the renderer. Returns true if the PTY should resume. */
  onAck(bytes: number): boolean {
    this.unacked = Math.max(0, this.unacked - bytes)
    if (this.paused && this.unacked <= PTY.LOW_WATER) {
      this.paused = false
      return true
    }
    return false
  }

  get isPaused(): boolean {
    return this.paused
  }
}
