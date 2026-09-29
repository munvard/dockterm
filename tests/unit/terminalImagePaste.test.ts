import { describe, it, expect } from 'vitest'
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
