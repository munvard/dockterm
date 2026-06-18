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

  it('ignores non-keydown events', () => {
    expect(resolveTermKey(ev({ type: 'keyup', ctrlKey: true, shiftKey: true, code: 'KeyC' }), 'linux')).toBeNull()
  })
})
