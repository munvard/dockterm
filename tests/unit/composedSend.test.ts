import { describe, it, expect } from 'vitest'
import { sendComposedWith, IMAGE_TIMEOUT_MS, type SendDeps } from '../../src/renderer/src/state/composedSend'
import type { Attachment } from '../../src/renderer/src/components/chat/composerText'

const img = (path: string): Attachment => ({ id: path, kind: 'image', path, name: path })
const doc = (path: string): Attachment => ({ id: path, kind: 'file', path, name: path })

function harness(
  opts: { bracketed?: boolean; markersAfterMs?: number | null; markers?: number; claude?: () => boolean; trace?: boolean } = {}
) {
  const log: string[] = []
  let clock = 0
  let pasted = false
  let pasteAt = 0
  const warnings: string[] = []
  const deps: SendDeps = {
    bracketedPaste: () => opts.bracketed ?? true,
    write: (_id, text) => {
      log.push(`write:${JSON.stringify(text)}`)
      pasted = true
      pasteAt = clock
      return true
    },
    visibleText: () => {
      const n = pasted && opts.markersAfterMs !== null && clock - pasteAt >= (opts.markersAfterMs ?? 0) ? opts.markers ?? 1 : 0
      return Array.from({ length: n }, (_, i) => `[Image #${i + 1}]`).join(' ')
    },
    sendPrompt: async (_id, text) => {
      log.push(`prompt:${JSON.stringify(text)}`)
      return true
    },
    isClaude: async () => {
      if (opts.trace) log.push('check')
      return opts.claude ? opts.claude() : true
    },
    sleep: async (ms) => {
      clock += ms
    },
    now: () => clock,
    warn: (m) => warnings.push(m)
  }
  return { deps, log, warnings, clock: () => clock }
}

const base = { chips: [], root: '/p', platform: 'darwin' as const }

describe('sendComposedWith', () => {
  it('sends plain text straight through sendPrompt', async () => {
    const h = harness()
    expect(await sendComposedWith(h.deps, 'l', { ...base, text: 'hello', attachments: [] })).toBe(true)
    expect(h.log).toEqual(['prompt:"hello"'])
  })

  it('pastes images first in their own bracketed paste, waits for the marker, then sends text with a leading space', async () => {
    const h = harness({ markersAfterMs: 180, markers: 2 })
    const ok = await sendComposedWith(h.deps, 'l', {
      ...base,
      text: 'what is this',
      attachments: [img('/t/a.png'), img('/t/b c.png')],
    })
    expect(ok).toBe(true)
    expect(h.log[0]).toBe('write:' + JSON.stringify('\x1b[200~/t/a.png\n"/t/b c.png"\x1b[201~'))
    expect(h.log[1]).toBe('prompt:" what is this"')
    expect(h.warnings).toEqual([])
  })

  it('waits for as many markers as there are images', async () => {
    const h = harness({ markers: 1 }) // only ever shows one marker for two images
    await sendComposedWith(h.deps, 'l', { ...base, text: 'x', attachments: [img('/a.png'), img('/b.png')] })
    expect(h.warnings).toHaveLength(1)
    expect(h.clock()).toBeGreaterThanOrEqual(IMAGE_TIMEOUT_MS)
  })

  it('warns after 4 s without a marker and still sends the text', async () => {
    const h = harness({ markersAfterMs: null })
    const ok = await sendComposedWith(h.deps, 'l', { ...base, text: 'go', attachments: [img('/a.png')] })
    expect(ok).toBe(true)
    expect(h.warnings).toHaveLength(1)
    expect(h.clock()).toBeGreaterThanOrEqual(IMAGE_TIMEOUT_MS)
    expect(h.clock()).toBeLessThan(IMAGE_TIMEOUT_MS + 200)
    expect(h.log.at(-1)).toBe('prompt:" go"')
  })

  it('counts markers already on screen as the baseline', async () => {
    const log: string[] = []
    let clock = 0
    let pasted = false
    const deps: SendDeps = {
      bracketedPaste: () => true,
      write: () => ((pasted = true), true),
      visibleText: () => (pasted ? '[Image #1] [Image #2]' : '[Image #1]'),
      sendPrompt: async (_i, t) => (log.push(t), true),
      isClaude: async () => true,
      sleep: async (ms) => void (clock += ms),
      now: () => clock,
      warn: () => log.push('WARN')
    }
    await sendComposedWith(deps, 'l', { ...base, text: 'x', attachments: [img('/a.png')] })
    expect(log).toEqual([' x'])
  })

  it('sends images only (no text) as a single space so Claude submits', async () => {
    const h = harness()
    await sendComposedWith(h.deps, 'l', { ...base, text: '', attachments: [img('/a.png')] })
    expect(h.log.at(-1)).toBe('prompt:" "')
  })

  it('uses forward slashes for win32 image paths', async () => {
    const h = harness()
    await sendComposedWith(h.deps, 'l', {
      ...base,
      platform: 'win32',
      text: 'x',
      attachments: [img('C:\\Users\\me\\a.png')]
    })
    expect(h.log[0]).toBe('write:' + JSON.stringify('\x1b[200~C:/Users/me/a.png\x1b[201~'))
  })

  it('joins by spaces without bracketed paste (a newline would submit)', async () => {
    const h = harness({ bracketed: false })
    await sendComposedWith(h.deps, 'l', { ...base, text: 'x', attachments: [img('/a.png'), img('/b.png')] })
    expect(h.log[0]).toBe('write:' + JSON.stringify('/a.png /b.png'))
  })

  it('expands chips and appends file refs, images unaffected', async () => {
    const h = harness()
    await sendComposedWith(h.deps, 'l', {
      ...base,
      text: 'see [Pasted text #1]',
      chips: [{ id: 1, text: 'LOG' }],
      attachments: [doc('/p/src/a.ts'), doc('/other/b.ts')]
    })
    expect(h.log).toEqual(['prompt:"see LOG\\n@src/a.ts /other/b.ts"'])
  })

  it('returns false when the pane cannot be written to', async () => {
    const h = harness()
    h.deps.write = () => false
    expect(await sendComposedWith(h.deps, 'l', { ...base, text: 'x', attachments: [img('/a.png')] })).toBe(false)
    expect(h.log).toEqual([])
  })

  it('does nothing for an empty message', async () => {
    const h = harness()
    expect(await sendComposedWith(h.deps, 'l', { ...base, text: '  ', attachments: [] })).toBe(false)
    expect(h.log).toEqual([])
  })
})

describe('sendComposedWith paste safety', () => {
  it('rejects an image path with control characters and never lets it end the paste', async () => {
    const h = harness()
    const evil = '/t/a.png\x1b[201~rm -rf ~\r'
    const ok = await sendComposedWith(h.deps, 'l', { ...base, text: 'hi', attachments: [img(evil)] })
    expect(ok).toBe(true)
    expect(h.log).toEqual(['prompt:"hi"'])
    expect(h.warnings).toHaveLength(1)
  })

  it('skips a file chip whose path has control characters', async () => {
    const h = harness()
    await sendComposedWith(h.deps, 'l', {
      ...base,
      text: 'see',
      attachments: [doc('/p/x\n.txt'), doc('/p/ok.txt')]
    })
    expect(h.log).toEqual(['prompt:"see\\n@ok.txt"'])
  })

  it('strips a terminating sequence from the text of a send (chips too)', async () => {
    const { wrapBracketedPaste } = await import('../../src/renderer/src/components/terminal/terminalSelection')
    expect(wrapBracketedPaste('x\x1b[201~rm -rf ~\r')).toBe('\x1b[200~x[201~rm -rf ~\n\x1b[201~')
  })
})

describe('sendComposedWith Claude-only gate', () => {
  it('writes nothing when Claude is not the foreground program', async () => {
    const h = harness({ claude: () => false })
    const ok = await sendComposedWith(h.deps, 'l', {
      ...base,
      text: 'rm -rf ~',
      attachments: [img('/t/a.png')]
    })
    expect(ok).toBe(false)
    expect(h.log).toEqual([])
  })

  it('checks again after the image wait, right before the prompt', async () => {
    let alive = true
    const h = harness({ markersAfterMs: 120, trace: true, claude: () => alive })
    const orig = h.deps.sleep
    h.deps.sleep = async (ms) => {
      await orig(ms)
      alive = false // Claude exits while we wait for the image marker
    }
    const ok = await sendComposedWith(h.deps, 'l', { ...base, text: 'hi', attachments: [img('/t/a.png')] })
    expect(ok).toBe(false)
    expect(h.log.some((l) => l.startsWith('prompt:'))).toBe(false)
    expect(h.log[0]).toBe('check')
    expect(h.log[1].startsWith('write:')).toBe(true)
    expect(h.log[h.log.length - 1]).toBe('check')
  })
})
