import { describe, it, expect } from 'vitest'
import { THEMES, resolveTheme, DEFAULT_THEME_ID } from '@renderer/state/themes'

describe('themes', () => {
  it('every theme defines the same ui keys and a full xterm palette', () => {
    const keys = Object.keys(THEMES[0].ui).sort()
    for (const t of THEMES) {
      expect(Object.keys(t.ui).sort()).toEqual(keys)
      expect(t.terminal.background).toBeTruthy()
      expect(t.terminal.brightWhite).toBeTruthy()
    }
  })

  it('resolveTheme auto follows system appearance', () => {
    expect(resolveTheme('auto', true).appearance).toBe('dark')
    expect(resolveTheme('auto', false).appearance).toBe('light')
  })

  it('resolveTheme falls back to the default for an unknown id', () => {
    expect(resolveTheme('nope', true).id).toBe(DEFAULT_THEME_ID)
  })

  it('resolveTheme returns a known theme by id', () => {
    expect(resolveTheme('nord', true).id).toBe('nord')
  })
})
