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
  state: {
    claude: ClaudeState
    mode: 'hold' | 'tap'
    autoSubmit: boolean
    pane: boolean
    enabled: boolean
    fresh: { enabled: boolean; mode: 'hold' | 'tap'; autoSubmit: boolean } | null
    claudeHere: boolean
  }
}

function make(): Env {
  let visible = screen(['❯'])
  const writes: string[] = []
  const transcripts: string[] = []
  const snaps: VoiceSnapshot[] = []
  const commands: string[] = []
  const state: Env['state'] = {
    claude: 'idle',
    mode: 'hold',
    autoSubmit: false,
    pane: true,
    enabled: false,
    fresh: null,
    claudeHere: true
  }
  const m = new VoiceMachine({
    write: (d) => {
      if (!state.pane) return false
      writes.push(d)
      return true
    },
    visibleText: () => visible,
    claudeState: () => state.claude,
    settings: () => ({ enabled: state.enabled, mode: state.mode, autoSubmit: state.autoSubmit }),
    readSettings: async () => state.fresh,
    claudeHere: () => state.claudeHere,
    sendCommand: async (t) => {
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
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: 'none' })
    expect(e.writes[e.writes.length - 1]).toBe('\x15\x15\x15')
  })

  it('no indicator within 1.5 s: stops, Ctrl+U x2, shows the hint', () => {
    const e = make()
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS - 1)
    expect(e.m.getSnapshot().hint).toBe('none')
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: 'enable' })
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
    expect(e.m.getSnapshot().hint).toBe('enable')
  })

  it('hint button runs an explicit `/voice hold` (never a bare toggle), only when Claude is idle with an empty input', async () => {
    const e = make()
    e.state.fresh = { enabled: false, mode: 'hold', autoSubmit: false }
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(e.m.getSnapshot().hint).toBe('enable')

    e.state.claude = 'working'
    expect(await e.m.enableVoice()).toBe(false)
    e.state.claude = 'idle'
    e.set(screen(['❯ half typed']))
    expect(await e.m.enableVoice()).toBe(false)
    expect(e.commands).toEqual([])

    e.set(screen(['❯']))
    expect(await e.m.enableVoice()).toBe(true)
    expect(e.commands).toEqual(['/voice hold'])
    expect(e.m.getSnapshot().hint).toBe('none')
  })

  it('hint button uses the tap mode from the fresh settings', async () => {
    const e = make()
    e.state.fresh = { enabled: false, mode: 'tap', autoSubmit: false }
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    await e.m.enableVoice()
    expect(e.commands).toEqual(['/voice tap'])
  })

  it('I4: voice already enabled -> the plain hint, and Enable can never send a toggling /voice', async () => {
    const e = make()
    e.state.enabled = true
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(e.m.getSnapshot().hint).toBe('not-started')

    // The hint was stale: settings were read fresh at click time and voice is on.
    e.state.enabled = false
    e.m.dismissHint()
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(e.m.getSnapshot().hint).toBe('enable')
    e.state.fresh = { enabled: true, mode: 'hold', autoSubmit: false }
    expect(await e.m.enableVoice()).toBe(false)
    expect(e.commands).toEqual([])
    expect(e.m.getSnapshot().hint).toBe('not-started')
  })

  it('I4: an unreadable settings file never leads to a /voice command', async () => {
    const e = make()
    e.state.fresh = null
    e.m.start()
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(await e.m.enableVoice()).toBe(false)
    expect(e.commands).toEqual([])
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

  // Screens below follow Claude Code 2.1.284 (checked against its binary): auto-submit only happens
  // for a transcript of 3 or more words, and then the input box is empty again. Under 3 words the
  // transcript stays in the input box.
  it('autoSubmit, 3+ words: Claude submitted it, so DockTerm reads nothing and clears nothing', () => {
    const e = make()
    e.state.autoSubmit = true
    e.m.start()
    e.set(screen(['❯ please run the tests'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.POLL_MS)
    // an empty box waits a moment for a possible error line, then settles
    expect(e.m.getSnapshot().phase).toBe('finishing')
    vi.advanceTimersByTime(T.ERROR_GRACE_MS + T.POLL_MS)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.m.getSnapshot().hint).toBe('none')
    expect(e.transcripts).toEqual([])
    expect(e.writes.some((w) => w.includes('\x15'))).toBe(false)
  })

  it('Windows, 2026-09-30 (real debug log): ❯ + no-break space rows give the transcript to the composer', () => {
    const NB = '\u00a0'
    const e = make()
    e.m.start()
    e.set(screen([`❯${NB}▁`], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen([`❯${NB}Hi, how are▁`], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot().interim).toBe('Hi, how are')
    e.m.stop()
    e.set(screen([`❯${NB}Hi, how are you doing?`], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen([`❯${NB}Hi, how are you doing?`]))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.transcripts).toEqual(['Hi, how are you doing?'])
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.writes.at(-1)).toBe('\x15\x15\x15')
  })

  const NO_AUDIO =
    'No audio detected from microphone. Check that the correct input device is selected and that Claude Code has microphone access.'

  it('Windows, 2026-09-30: Claude says "No audio detected" after the hold: the strip shows that message', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ ▁'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot().interim).toBe('')
    e.m.stop()
    e.set(screen(['❯'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯'], `      ${NO_AUDIO}`))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: 'claude-error', message: NO_AUDIO })
    expect(e.transcripts).toEqual([])
    e.m.dismissHint()
    expect(e.m.getSnapshot()).toMatchObject({ hint: 'none', message: '' })
  })

  it('the error line may render one poll after the screen goes idle: it is still caught', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ ▁'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯'], '  No speech detected.'))
    vi.advanceTimersByTime(T.ERROR_GRACE_MS + T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: 'claude-error', message: 'No speech detected.' })
  })

  it('an error already on screen before the start is not blamed on the new recording', () => {
    const e = make()
    e.set(screen(['❯'], `  ${NO_AUDIO}`))
    e.m.start()
    e.set(screen(['❯ hello there'], `  ${NO_AUDIO}`))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ hello there'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯ hello there'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ hello there']))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({ phase: 'idle', hint: 'none' })
    expect(e.transcripts).toEqual(['hello there'])
  })

  it('no indicator, but Claude printed a login error: the strip shows it instead of the generic hint', () => {
    const e = make()
    e.state.enabled = true
    e.m.start()
    e.set(screen(['❯'], '  Voice mode requires a Claude.ai account. Please run /login to sign in.'))
    vi.advanceTimersByTime(T.START_TIMEOUT_MS + T.POLL_MS)
    expect(e.m.getSnapshot()).toMatchObject({
      phase: 'idle',
      hint: 'claude-error',
      message: 'Voice mode requires a Claude.ai account. Please run /login to sign in.'
    })
  })

  it('I3: autoSubmit, 1-2 words: Claude leaves them in its box, so they are taken into the composer and cleared', () => {
    const e = make()
    e.state.autoSubmit = true
    e.m.start()
    e.set(screen(['❯ yes please'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯ yes please'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ yes please']))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(e.transcripts).toEqual(['yes please'])
    expect(e.writes[e.writes.length - 1]).toBe('\x15\x15\x15')
  })

  it('I3: tap mode, 2 words left in the box, gets the same treatment', () => {
    const e = make()
    e.state.mode = 'tap'
    e.m.start()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS * 3)
    e.m.stop()
    e.set(screen(['❯ run tests'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ run tests']))
    vi.advanceTimersByTime(T.POLL_MS)
    expect(e.transcripts).toEqual(['run tests'])
    expect(e.writes[e.writes.length - 1]).toBe('\x15\x15\x15')
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
    vi.advanceTimersByTime(T.POLL_MS * 4)
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    expect(spaces(e.writes)).toBe(12)
  })

  it('I2: tap, Claude ends the recording itself (15 s silence): no stop burst, so no fresh recording', () => {
    const e = make()
    e.state.mode = 'tap'
    e.m.start()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS * 3)
    expect(spaces(e.writes)).toBe(6)
    e.set(screen(['❯'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.POLL_MS * 2)
    expect(e.m.getSnapshot().phase).toBe('finishing')
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS * 2)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(spaces(e.writes)).toBe(6) // never typed a second burst
    expect(vi.getTimerCount()).toBe(0)
  })

  it('I2: tap, a stop right after the start waits until Claude would not swallow it as a continuation', () => {
    const e = make()
    e.state.mode = 'tap'
    e.m.start()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop() // 200 ms after the start, before TAP_STOP_MIN_MS (250)
    expect(spaces(e.writes)).toBe(6)
    vi.advanceTimersByTime(T.POLL_MS - 1)
    expect(spaces(e.writes)).toBe(6) // still waiting
    vi.advanceTimersByTime(1)
    expect(spaces(e.writes)).toBeGreaterThan(6) // sent at the first poll after 250 ms
  })

  it('I2: tap, REC still showing 600 ms after the stop burst: the stop was swallowed, so Esc cancels', () => {
    const e = make()
    e.state.mode = 'tap'
    e.m.start()
    vi.advanceTimersByTime(T.TAP_GAP_MS * 5)
    e.set(screen(['❯'], '  ● REC · tap to send'))
    vi.advanceTimersByTime(T.POLL_MS * 4)
    e.m.stop()
    vi.advanceTimersByTime(T.TAP_STUCK_REC_MS - 100)
    expect(e.writes.includes('\x1b')).toBe(false)
    vi.advanceTimersByTime(T.POLL_MS * 3)
    expect(e.writes.includes('\x1b')).toBe(true)
    vi.advanceTimersByTime(T.ESC_CLEAR_GAP_MS)
    expect(e.writes[e.writes.length - 1]).toMatch(/^\x15+$/)
    expect(e.m.getSnapshot().phase).toBe('idle')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('M3: hold, Claude released by itself (a stalled renderer): the space stream stops at once', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ hello'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.set(screen(['❯ hello'], '  Voice: processing…'))
    vi.advanceTimersByTime(T.POLL_MS)
    const n = spaces(e.writes)
    vi.advanceTimersByTime(1000)
    expect(spaces(e.writes)).toBe(n)
    expect(e.m.getSnapshot().phase).toBe('finishing')
  })

  it('M11: recorded but no text and no processing seen: a plain "no speech" hint', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.m.stop()
    e.set(screen(['❯']))
    vi.advanceTimersByTime(T.NO_PROCESSING_GRACE_MS + T.POLL_MS)
    expect(e.transcripts).toEqual([])
    expect(e.m.getSnapshot().hint).toBe('no-speech')
  })

  it('step 3: Claude leaves the pane (shell prompt on screen): the stream stops with no further writes', () => {
    const e = make()
    e.m.start()
    e.set(screen(['❯ hel'], '  listening…'))
    vi.advanceTimersByTime(T.POLL_MS)
    e.state.claudeHere = false
    e.set('~/proj $ ')
    vi.advanceTimersByTime(T.POLL_MS * 2)
    expect(e.m.getSnapshot().phase).toBe('idle')
    const n = e.writes.length
    vi.advanceTimersByTime(2000)
    expect(e.writes.length).toBe(n)
    expect(vi.getTimerCount()).toBe(0)
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
