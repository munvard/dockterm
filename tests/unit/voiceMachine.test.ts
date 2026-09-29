import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  VoiceMachine,
  VOICE_TIMING as T,
  type VoiceSnapshot
} from '../../src/renderer/src/components/chat/voiceMachine'
import type { ClaudeState } from '../../src/renderer/src/components/terminal/claudeStatus'

const RULE = '─'.repeat(100)
const screen = (box: string[], banner = ''): string =>
  ['', banner, RULE, ...box, RULE, '  ⏵⏵ auto mode on (shift+tab to cycle)'].join('\n')

interface Env {
  m: VoiceMachine
  writes: string[]
  transcripts: string[]
  snaps: VoiceSnapshot[]
  commands: string[]
  set: (s: string) => void
  state: { claude: ClaudeState; mode: 'hold' | 'tap'; autoSubmit: boolean; pane: boolean }
}

function make(): Env {
  let visible = screen(['❯'])
  const writes: string[] = []
  const transcripts: string[] = []
  const snaps: VoiceSnapshot[] = []
  const commands: string[] = []
  const state = { claude: 'idle' as ClaudeState, mode: 'hold' as 'hold' | 'tap', autoSubmit: false, pane: true }
  const m = new VoiceMachine({
    write: (d) => {
      if (!state.pane) return false
      writes.push(d)
      return true
    },
    visibleText: () => visible,
    claudeState: () => state.claude,
    settings: () => ({ mode: state.mode, autoSubmit: state.autoSubmit }),
    sendCommand: (t) => {
      commands.push(t)
      return true
    },
    onSnapshot: (s) => snaps.push(s),
    onTranscript: (t) => transcripts.push(t)
  })
  return { m, writes, transcripts, snaps, commands, set: (s) => (visible = s), state }
}

const spaces = (w: string[]): number => w.filter((x) => x === ' ').length

describe('VoiceMachine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('hold: types a space at once and every 40 ms, polls every 100 ms, shows interim', () => {
    const e = make()
    expect(e.m.start()).toBe('ok')
    expect(e.writes).toEqual([' '])
    vi.advanceTimersByTime(T.HOLD_STREAM_MS * 5)
    expect(spaces(e.writes)).toBe(6)
    e.set(screen(['❯ hello wor'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'recording', status: 'listening', interim: 'hello wor' })
  })

  it('hold: stop ends the stream, waits for processing, inserts the transcript, clears Claude by lines + 2', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ hello world this is long', '  and wraps'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    const spacesAtStop = spaces(e.writes)
    vi.advanceTimersByTime(1000)
    expect(spaces(e.writes)).toBe(spacesAtStop) // stream stopped
    expect(e.m.getSnapshot().phase).toBe('finishing')
    e.set(screen(['❯ hello world this is long', '  and wraps'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS * 3)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'finishing', status: 'processing' })
    expect(e.transcripts).toEqual([])
    e.set(screen(['❯ hello world this is long', '  and wraps and more']))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.transcripts).toEqual(['hello world this is long and wraps and more'])
    expect(e.writes[e.writes.length - 1]).toBe('\x15'.repeat(4)) // 2 lines + 2
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hold: gives up waiting for processing after 8 s and still reads the box', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ partial words'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯ partial words'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.PROCESSING_TIMEOUT_MS - 200)
    expect(e.m.getSnapshot().phase).toBe('finishing')
    vi.advanceTimersByTime(300)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.transcripts).toEqual(['partial words'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('hold: a hold too short to register just cleans the stray spaces, no hint, no transcript', () => {
    const e = make()
    e.m.start()
    vi.advanceTimersByTime(100)
    e.m.stop()
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS)
    expect(e.transcripts).toEqual([])
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: false })
    expect(e.writes[e.writes.length - 1]).toBe('\x15\x15\x15')
  })

  it('no indicator within 1.5 s: stops, Ctrl+U x2, shows the hint', () => {
    const e = make()
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS - 1)
    expect(e.m.getSnapshot().hint).toBe(false)
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: true })
    expect(e.writes[e.writes.length - 1]).toBe('\x15\x15')
    const n = e.writes.length
    vi.advanceTimersByTime(1000)
    expect(e.writes.length).toBe(n) // stream is off
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a stop after 700 ms with no indicator ever seen also shows the hint', () => {
    const e = make()
    e.m.start()
    vi.advanceTimersByTime(800)
    e.m.stop()
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS)
    expect(e.m.getSnapshot().hint).toBe(true)
  })

  it('hint button writes /voice through sendCommand, only when Claude is idle with an empty input', () => {
    const e = make()
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(e.m.getSnapshot().hint).toBe(true)

    e.state.claude = 'working'
    expect(e.m.enableVoice()).toBe(false)
    e.state.claude = 'idle'
    e.set(screen(['❯ half typed']))
    expect(e.m.enableVoice()).toBe(false)
    expect(e.commands).toEqual([])

    e.set(screen(['❯']))
    expect(e.m.enableVoice()).toBe(true)
    expect(e.commands).toEqual(['/voice'])
    expect(e.m.getSnapshot().hint).toBe(false)
  })

  it('does not start while Claude is asking, and types nothing', () => {
    const e = make()
    e.state.claude = 'asking'
    expect(e.m.start()).toBe('asking')
    expect(e.writes).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('starts while Claude is working', () => {
    const e = make()
    e.state.claude = 'working'
    expect(e.m.start()).toBe('ok')
  })

  it('a second start while active is refused', () => {
    const e = make()
    e.m.start()
    expect(e.m.start()).toBe('busy')
  })

  it('no pane: start fails and leaves no timers', () => {
    const e = make()
    e.state.pane = false
    expect(e.m.start()).toBe('no-pane')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('autoSubmit: does not read or clear Claude input, just ends the strip', () => {
    const e = make()
    e.state.autoSubmit = true
    e.m.start()
    e.set(screen(['❯ send it'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.transcripts).toEqual([])
    expect(e.writes.some((w) => w.includes('\x15'))).toBe(false)
  })

  it('tap: a burst of 6 spaces 20 ms apart starts, another stops, Claude submits itself', () => {
    const e = make()
    e.state.mode = 'tap'
    expect(e.m.start()).toBe('ok')
    expect(e.writes).toEqual([' '])
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    expect(e.writes).toEqual([' ', ' ', ' ', ' ', ' ', ' '])
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'recording', status: 'rec' })
    // no continuous stream in tap mode
    vi.advanceTimersByTime(1000)
    expect(spaces(e.writes)).toBe(6)
    e.m.stop()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    expect(spaces(e.writes)).toBe(12)
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.transcripts).toEqual([])
    expect(e.writes.some((w) => w.includes('\x15'))).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('tap: refuses to start when Claude already has text in its input', () => {
    const e = make()
    e.state.mode = 'tap'
    e.set(screen(['❯ draft in claude']))
    expect(e.m.start()).toBe('input-not-empty')
    expect(e.writes).toEqual([])
  })

  it('tap: a stop requested before REC appears waits for the indicator instead of toggling twice', () => {
    const e = make()
    e.state.mode = 'tap'
    e.m.start()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    e.m.stop()
    expect(spaces(e.writes)).toBe(6)
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS)
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    expect(spaces(e.writes)).toBe(12)
  })

  it('Esc cancel while recording: Esc alone, then Ctrl+U in a separate write, no timers left', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ hel'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    const before = e.writes.length
    e.m.cancel()
    expect(e.writes.slice(before)).toEqual(['\x1b'])
    vi.advanceTimersByTime(T.ESC_CLEAR_GAP_MS)
    expect(e.writes.slice(before)).toEqual(['\x1b', '\x15\x15\x15'])
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
    expect(e.transcripts).toEqual([])
  })

  it('a new start right after a cancel flushes the pending Ctrl+U first', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ hel'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.cancel()
    const before = e.writes.length
    e.m.start()
    expect(e.writes.slice(before)).toEqual(['\x15\x15\x15', ' '])
  })

  it('cancel before any indicator does NOT send Esc (it would interrupt a working turn)', () => {
    const e = make()
    e.state.claude = 'working'
    e.m.start()
    vi.advanceTimersByTime(300)
    const before = e.writes.length
    e.m.cancel()
    expect(e.writes.slice(before)).toEqual(['\x15\x15\x15'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('dispose (unmount) mid-recording leaves no timers and stops notifying', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ x'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    const snaps = e.snaps.length
    e.m.dispose()
    vi.advanceTimersByTime(T.ESC_CLEAR_GAP_MS)
    expect(vi.getTimerCount()).toBe(0)
    expect(e.snaps.length).toBe(snaps)
    expect(e.m.start()).toBe('no-pane')
  })

  it('cancel while idle is a no-op', () => {
    const e = make()
    e.m.cancel()
    expect(e.writes).toEqual([])
  })

  it('Claude ending the recording on its own finishes as if released', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ said it'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ said it']))
    vi.advanceTimersByTime(T.POLL_MS * 2)
    expect(e.m.getSnapshot().phase).toBe('finishing')
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS)
    expect(e.transcripts).toEqual(['said it'])
    const n = e.writes.length
    vi.advanceTimersByTime(500)
    expect(e.writes.length).toBe(n)
  })
})
