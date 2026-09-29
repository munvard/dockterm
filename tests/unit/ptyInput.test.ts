import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPtyInput } from '../../src/renderer/src/components/terminal/ptyInput'
import { paneWriters } from '../../src/renderer/src/state/paneWriters'
import { sendPrompt } from '../../src/renderer/src/state/sendPrompt'
import { launchCommand } from '../../src/renderer/src/components/terminal/launcherCommands'

const PS = '\x1b[200~'
const PE = '\x1b[201~'

/** A pane whose `paste` behaves like xterm 6's Terminal.paste
 * (node_modules/@xterm/xterm/src/browser/Clipboard.ts): newlines become \r and
 * the text is wrapped in bracketed-paste markers when the app turned that mode
 * on. Whatever finally reaches the PTY is collected in `pty`. */
function makePane(opts: { bracketed: boolean; session?: boolean }) {
  const pty: string[] = []
  let session: string | null = opts.session === false ? null : 's1'
  const input = createPtyInput({
    sessionId: () => session,
    send: (_sid, data) => pty.push(data),
    termPaste: (text) => {
      const t = text.replace(/\r?\n/g, '\r')
      pty.push(opts.bracketed ? PS + t + PE : t)
    }
  })
  paneWriters.register('leaf', {
    write: input.write,
    paste: input.paste,
    bracketedPaste: () => opts.bracketed
  })
  return {
    pty,
    input,
    ready: () => {
      session = 's1'
      input.flush()
    }
  }
}

describe('app-sent pane input reaches the PTY raw (C1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    paneWriters.unregister('leaf')
  })

  it('(a) the launcher command is exactly `claude\\r`, not a paste, with bracketed-paste on', () => {
    const pane = makePane({ bracketed: true })
    expect(paneWriters.write('leaf', launchCommand('new'))).toBe(true)
    expect(pane.pty).toEqual(['claude\r'])
  })

  it('(b) a Composer send is the wrapped text, then a separate raw \\r', async () => {
    const pane = makePane({ bracketed: true })
    const done = sendPrompt('leaf', 'hello\nworld')
    expect(pane.pty).toEqual([PS + 'hello\nworld' + PE])
    vi.advanceTimersByTime(70)
    await expect(done).resolves.toBe(true)
    expect(pane.pty).toEqual([PS + 'hello\nworld' + PE, '\r'])
  })

  it('(b) without bracketed-paste mode the text is not wrapped at all', () => {
    const pane = makePane({ bracketed: false })
    sendPrompt('leaf', 'ls -la')
    vi.advanceTimersByTime(70)
    expect(pane.pty).toEqual(['ls -la', '\r'])
  })

  it('(c) AskCard / munu keys and Esc arrive as the exact key bytes', () => {
    const pane = makePane({ bracketed: true })
    for (const key of ['\x1b[B', '2', '\r', '\x1b']) paneWriters.write('leaf', key)
    expect(pane.pty).toEqual(['\x1b[B', '2', '\r', '\x1b'])
  })

  it('a real user paste still goes through the paste path (wrapped, \\n -> \\r)', () => {
    const pane = makePane({ bracketed: true })
    paneWriters.paste('leaf', 'a\nb')
    expect(pane.pty).toEqual([PS + 'a\rb' + PE])
  })

  it('input sent before the PTY exists is queued raw and flushed in order', () => {
    const pane = makePane({ bracketed: true, session: false })
    paneWriters.write('leaf', 'claude\r')
    paneWriters.paste('leaf', 'x')
    expect(pane.pty).toEqual([])
    pane.ready()
    expect(pane.pty).toEqual(['claude\rx'])
  })
})
