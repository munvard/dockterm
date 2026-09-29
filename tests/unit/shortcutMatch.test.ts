import { describe, it, expect } from 'vitest'
import { matchShortcut, type KeyLike } from '@renderer/hooks/keys'

/** A bare keydown with everything false, overridden per test. */
function key(overrides: Partial<KeyLike>): KeyLike {
  return { code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides }
}

describe('matchShortcut', () => {
  it('mac: Cmd+B toggles the files panel', () => {
    const r = matchShortcut(key({ code: 'KeyB', metaKey: true }), 'mac')
    expect(r).toEqual({ id: 'panel:files' })
  })

  it('win/linux: Ctrl+Shift+B toggles the files panel', () => {
    for (const platform of ['win', 'linux'] as const) {
      const r = matchShortcut(key({ code: 'KeyB', ctrlKey: true, shiftKey: true }), platform)
      expect(r).toEqual({ id: 'panel:files' })
    }
  })

  it('plain Ctrl+letter on Windows/Linux always passes through (returns null)', () => {
    // Ctrl+R is reverse-search, Ctrl+W deletes a word, Ctrl+M is a carriage
    // return — none of these may ever be intercepted without Shift.
    for (const code of ['KeyR', 'KeyW', 'KeyT', 'KeyN', 'KeyB', 'KeyG', 'KeyE']) {
      const r = matchShortcut(key({ code, ctrlKey: true }), 'win')
      expect(r, `Ctrl+${code} should pass through on win`).toBeNull()
      const rl = matchShortcut(key({ code, ctrlKey: true }), 'linux')
      expect(rl, `Ctrl+${code} should pass through on linux`).toBeNull()
    }
  })

  it('plain Ctrl+, / = / - / 0 (and numpad) on Windows/Linux go to the terminal (I8)', () => {
    // Ctrl+- is readline's undo (Ctrl+_); Ctrl+0 / Ctrl+= / Ctrl+, are the terminal's.
    for (const code of ['Comma', 'Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0']) {
      for (const platform of ['win', 'linux'] as const) {
        expect(matchShortcut(key({ code, ctrlKey: true }), platform), `Ctrl+${code} on ${platform}`).toBeNull()
      }
    }
  })

  it('settings and zoom use Ctrl+Shift on Windows/Linux and Cmd on mac (I8)', () => {
    for (const platform of ['win', 'linux'] as const) {
      const cs = { ctrlKey: true, shiftKey: true }
      expect(matchShortcut(key({ code: 'Comma', ...cs }), platform)).toEqual({ id: 'settings' })
      expect(matchShortcut(key({ code: 'Equal', ...cs }), platform)).toEqual({ id: 'zoomIn' })
      expect(matchShortcut(key({ code: 'Minus', ...cs }), platform)).toEqual({ id: 'zoomOut' })
      expect(matchShortcut(key({ code: 'Digit0', ...cs }), platform)).toEqual({ id: 'zoomReset' })
    }
    expect(matchShortcut(key({ code: 'Comma', metaKey: true }), 'mac')).toEqual({ id: 'settings' })
    expect(matchShortcut(key({ code: 'Equal', metaKey: true }), 'mac')).toEqual({ id: 'zoomIn' })
    expect(matchShortcut(key({ code: 'Equal', metaKey: true, shiftKey: true }), 'mac')).toEqual({ id: 'zoomIn' })
    expect(matchShortcut(key({ code: 'Minus', metaKey: true }), 'mac')).toEqual({ id: 'zoomOut' })
    expect(matchShortcut(key({ code: 'Digit0', metaKey: true }), 'mac')).toEqual({ id: 'zoomReset' })
    expect(matchShortcut(key({ code: 'Minus', ctrlKey: true }), 'mac')).toBeNull()
  })

  it('mac: plain Ctrl (no Cmd) never matches an app shortcut', () => {
    const r = matchShortcut(key({ code: 'KeyB', ctrlKey: true }), 'mac')
    expect(r).toBeNull()
  })

  it('matches on e.code, not e.key, so non-Latin layouts still fire (Armenian, Russian…)', () => {
    // A physical "T" keypress on an Armenian layout produces e.key: 'թ', not
    // 't' — matchShortcut never looks at key at all, only code, so the
    // shortcut in the same physical position still fires.
    const r = matchShortcut(key({ code: 'KeyT', metaKey: true }), 'mac')
    expect(r).toEqual({ id: 'newTab' })
  })

  it('review moved to E; R is the chat/terminal toggle (not the review panel)', () => {
    expect(matchShortcut(key({ code: 'KeyE', metaKey: true }), 'mac')).toEqual({ id: 'panel:review' })
    expect(matchShortcut(key({ code: 'KeyR', metaKey: true }), 'mac')).toEqual({ id: 'toggleChat' })
    expect(matchShortcut(key({ code: 'KeyE', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'panel:review'
    })
    expect(matchShortcut(key({ code: 'KeyR', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'toggleChat'
    })
  })

  it('switches to tab N by digit (1-9), Cmd/Ctrl+Shift only', () => {
    expect(matchShortcut(key({ code: 'Digit3', metaKey: true }), 'mac')).toEqual({
      id: 'switchTab',
      tabIndex: 2
    })
    expect(matchShortcut(key({ code: 'Digit3', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'switchTab',
      tabIndex: 2
    })
    // Plain Ctrl+3 (no Shift) on win/linux must not switch tabs.
    expect(matchShortcut(key({ code: 'Digit3', ctrlKey: true }), 'win')).toBeNull()
  })

  it('close: Cmd+W (mac) / Ctrl+Shift+W (win) fires; plain Ctrl+W never does', () => {
    expect(matchShortcut(key({ code: 'KeyW', metaKey: true }), 'mac')).toEqual({ id: 'close' })
    expect(matchShortcut(key({ code: 'KeyW', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'close'
    })
    expect(matchShortcut(key({ code: 'KeyW', ctrlKey: true }), 'win')).toBeNull()
  })

  it('compose: Cmd/Ctrl+Shift+Enter opens the compose overlay', () => {
    expect(matchShortcut(key({ code: 'Enter', metaKey: true, shiftKey: true }), 'mac')).toEqual({
      id: 'compose'
    })
    expect(matchShortcut(key({ code: 'Enter', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'compose'
    })
    // Ctrl+Shift+Enter on mac (no Cmd) must not fire — mac shortcuts are Cmd-only.
    expect(matchShortcut(key({ code: 'Enter', ctrlKey: true, shiftKey: true }), 'mac')).toBeNull()
  })

  it('palette: Cmd+K (mac) / Ctrl+Shift+K (win) / Cmd|Ctrl+Shift+P (both)', () => {
    expect(matchShortcut(key({ code: 'KeyK', metaKey: true }), 'mac')).toEqual({ id: 'palette' })
    expect(matchShortcut(key({ code: 'KeyK', ctrlKey: true, shiftKey: true }), 'win')).toEqual({
      id: 'palette'
    })
    expect(matchShortcut(key({ code: 'KeyP', metaKey: true, shiftKey: true }), 'mac')).toEqual({
      id: 'palette'
    })
  })

  it('returns null for an unrelated keypress', () => {
    expect(matchShortcut(key({ code: 'KeyZ' }), 'mac')).toBeNull()
    expect(matchShortcut(key({ code: 'KeyZ', ctrlKey: true, shiftKey: true }), 'win')).toBeNull()
  })
})

describe('plain-text paste shortcut', () => {
  it('mac: Cmd+Shift+V', () => {
    expect(matchShortcut(key({ code: 'KeyV', metaKey: true, shiftKey: true }), 'mac')).toEqual({ id: 'pastePlain' })
  })
  it('win/linux: Ctrl+Shift+V', () => {
    for (const platform of ['win', 'linux'] as const) {
      expect(matchShortcut(key({ code: 'KeyV', ctrlKey: true, shiftKey: true }), platform)).toEqual({ id: 'pastePlain' })
    }
  })
  it('plain Cmd+V and Ctrl+V are never matched (native paste / the terminal)', () => {
    expect(matchShortcut(key({ code: 'KeyV', metaKey: true }), 'mac')).toBeNull()
    expect(matchShortcut(key({ code: 'KeyV', ctrlKey: true }), 'win')).toBeNull()
    expect(matchShortcut(key({ code: 'KeyV', ctrlKey: true }), 'linux')).toBeNull()
  })
})
