import { describe, it, expect } from 'vitest'
import { resolveTermKey, type TermKeyEvent } from '../../src/renderer/src/components/terminal/terminalKeys'

const ev = (p: Partial<TermKeyEvent>): TermKeyEvent => ({
  type: 'keydown',
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...p
})

describe('resolveTermKey', () => {
  it('keeps macOS Cmd+Up/Down scroll jumps', () => {
    expect(resolveTermKey(ev({ metaKey: true, key: 'ArrowDown' }), 'darwin')).toBe('scroll-bottom')
    expect(resolveTermKey(ev({ metaKey: true, key: 'ArrowUp' }), 'darwin')).toBe('scroll-top')
  })

  it('keeps Shift+PageUp/Down paging on every platform', () => {
    expect(resolveTermKey(ev({ shiftKey: true, key: 'PageUp' }), 'linux')).toBe('page-up')
    expect(resolveTermKey(ev({ shiftKey: true, key: 'PageDown' }), 'linux')).toBe('page-down')
  })

  it('maps Ctrl+Shift+C/V to copy/paste on Linux and Windows', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }), 'linux')).toBe('copy')
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, code: 'KeyV' }), 'win32')).toBe('paste')
  })

  it('does NOT hijack Ctrl+Shift+C on macOS (Cmd+C is native there)', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, code: 'KeyC' }), 'darwin')).toBeNull()
  })

  it('lets plain Ctrl+C (SIGINT) and other keys through', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyC' }), 'linux')).toBeNull()
    expect(resolveTermKey(ev({ key: 'a' }), 'linux')).toBeNull()
  })

  it('pastes on plain Ctrl+V on Windows only; Linux keeps it for vim, nano and readline', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyV', key: 'v' }), 'win32')).toBe('paste')
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyV', key: 'v' }), 'linux')).toBeNull()
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyV', key: 'v' }), 'darwin')).toBeNull()
  })

  it('takes Shift+Insert and Ctrl+Insert on Windows and Linux', () => {
    expect(resolveTermKey(ev({ shiftKey: true, key: 'Insert' }), 'linux')).toBe('paste')
    expect(resolveTermKey(ev({ ctrlKey: true, key: 'Insert' }), 'linux')).toBe('copy')
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, key: 'Insert' }), 'win32')).toBeNull()
  })

  it('copies on Ctrl+C only while text is selected, on Windows only (otherwise SIGINT)', () => {
    const k = ev({ ctrlKey: true, code: 'KeyC', key: 'c' })
    expect(resolveTermKey(k, 'win32', true)).toBe('copy')
    expect(resolveTermKey(k, 'win32', false)).toBeNull()
    expect(resolveTermKey(k, 'linux', true)).toBeNull()
    expect(resolveTermKey(k, 'darwin', true)).toBeNull()
  })

  it('keeps Ctrl+Shift+C/V working with a selection and by typed letter', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, key: 'V', code: 'KeyV' }), 'linux', true)).toBe('paste')
    expect(resolveTermKey(ev({ ctrlKey: true, shiftKey: true, key: 'C', code: 'KeyC' }), 'win32', true)).toBe('copy')
  })

  it('decides by the typed letter on Dvorak: Ctrl+K and Ctrl+J are not paste or copy', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyV', key: 'k' }), 'win32')).toBeNull()
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyC', key: 'j' }), 'win32', true)).toBeNull()
  })

  it('still works on a non-Latin layout (Cyrillic) through the physical key', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, code: 'KeyV', key: 'м' }), 'win32')).toBe('paste')
  })

  it('leaves AltGr (Ctrl+Alt) alone', () => {
    expect(resolveTermKey(ev({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' }), 'win32')).toBeNull()
  })

  it('ignores non-keydown events', () => {
    expect(resolveTermKey(ev({ type: 'keyup', ctrlKey: true, shiftKey: true, code: 'KeyC' }), 'linux')).toBeNull()
  })
})
