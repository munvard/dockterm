import { describe, it, expect, vi } from 'vitest'
import {
  handleImagePasteEvent,
  pasteImageFromSystemClipboard,
  type ImagePasteDeps
} from '../../src/renderer/src/components/terminal/terminalImagePaste'
import { pickImageMime, toComposerPlatform } from '../../src/renderer/src/components/chat/composerText'

describe('pickImageMime', () => {
  it('returns the image type only when there is no text', () => {
    expect(pickImageMime('', [{ type: 'image/png' }])).toBe('image/png')
    expect(pickImageMime('hello', [{ type: 'image/png' }])).toBeNull()
  })
  it('ignores unsupported image types and non-images', () => {
    expect(pickImageMime('', [{ type: 'image/bmp' }])).toBeNull()
    expect(pickImageMime('', [{ type: 'application/pdf' }])).toBeNull()
    expect(pickImageMime('', [])).toBeNull()
    expect(pickImageMime('', [{ type: 'application/pdf' }, { type: 'image/webp' }])).toBe('image/webp')
  })
})

describe('toComposerPlatform', () => {
  it('maps node platform names, unknown to linux', () => {
    expect(toComposerPlatform('win32')).toBe('win32')
    expect(toComposerPlatform('darwin')).toBe('darwin')
    expect(toComposerPlatform('')).toBe('linux')
  })
})

type Invoke = (channel: string, req?: unknown) => Promise<unknown>

/** Builds deps whose main-process calls all go through one fake `invoke`. */
function deps(
  invoke: Invoke,
  over: { claude?: () => boolean } = {}
): ImagePasteDeps & { pasted: string[]; warned: string[] } {
  const pasted: string[] = []
  const warned: string[] = []
  return {
    saveImage: (data, mime) => invoke('chat:saveImage', { data, mime }) as never,
    readFiles: () => invoke('clipboard:readFiles') as never,
    saveClipboardImage: () => invoke('clipboard:saveImage') as never,
    isClaude: async () => (over.claude ? over.claude() : true),
    paste: (t) => pasted.push(t),
    platform: 'darwin',
    warn: (m) => warned.push(m),
    pasted,
    warned
  }
}

function pasteEvent(files: { type: string }[], text = ''): ClipboardEvent {
  const list = files.map((f) => ({ ...f, arrayBuffer: async () => new ArrayBuffer(4) }))
  return {
    clipboardData: { getData: () => text, files: list },
    preventDefault: () => {},
    stopPropagation: () => {}
  } as unknown as ClipboardEvent
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('terminal image paste (Claude-only gate, order of sources)', () => {
  it('saves the image and pastes its path in a Claude pane', async () => {
    const d = deps(async (ch) => (ch === 'chat:saveImage' ? { ok: true, value: { path: '/tmp/x/a.png' } } : { ok: false }))
    expect(handleImagePasteEvent(pasteEvent([{ type: 'image/png' }]), d)).toBe(true)
    await flush()
    expect(d.pasted).toEqual(['/tmp/x/a.png'])
  })

  it('does nothing (and saves nothing) when Claude is not in front', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: { path: '/tmp/x/a.png' } }))
    const d = deps(invoke, { claude: () => false })
    handleImagePasteEvent(pasteEvent([{ type: 'image/png' }]), d)
    await flush()
    expect(invoke).not.toHaveBeenCalled()
    expect(d.pasted).toEqual([])
  })

  it('checks again after saving: Claude exiting meanwhile means no paste', async () => {
    let calls = 0
    const d = deps(async () => ({ ok: true, value: { path: '/tmp/x/a.png' } }), { claude: () => ++calls === 1 })
    handleImagePasteEvent(pasteEvent([{ type: 'image/png' }]), d)
    await flush()
    expect(d.pasted).toEqual([])
  })

  it('ignores a paste that carries text', () => {
    const d = deps(async () => ({ ok: false }))
    expect(handleImagePasteEvent(pasteEvent([{ type: 'image/png' }], 'hello'), d)).toBe(false)
  })

  it('system clipboard: copied image FILES win over a bitmap, non-images and unsafe names are skipped', async () => {
    const seen: string[] = []
    const d = deps(async (ch) => {
      seen.push(ch)
      if (ch === 'clipboard:readFiles')
        return { ok: true, value: { paths: ['/p/a.png', '/p/notes.txt', '/p/bad\n.png'] } }
      return { ok: true, value: { path: '/tmp/x/bitmap.png' } }
    })
    await pasteImageFromSystemClipboard(d)
    expect(d.pasted).toEqual(['/p/a.png'])
    expect(seen).toEqual(['clipboard:readFiles'])
  })

  it('system clipboard: falls back to the bitmap, and never pastes outside Claude', async () => {
    const invoke: Invoke = async (ch) =>
      ch === 'clipboard:readFiles' ? { ok: true, value: { paths: [] } } : { ok: true, value: { path: '/tmp/x/bitmap.png' } }
    const d = deps(invoke)
    await pasteImageFromSystemClipboard(d)
    expect(d.pasted).toEqual(['/tmp/x/bitmap.png'])
    const off = deps(invoke, { claude: () => false })
    await pasteImageFromSystemClipboard(off)
    expect(off.pasted).toEqual([])
  })
})
