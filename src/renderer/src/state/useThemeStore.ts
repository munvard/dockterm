import { create } from 'zustand'
import type { ITheme } from '@xterm/xterm'
import { resolveTheme, THEME_MAP, DEFAULT_THEME_ID, type Theme } from './themes'

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true
}

/** Push a theme's CSS custom properties onto :root and tag the appearance. */
function paint(theme: Theme): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${k}`, v)
  root.dataset.appearance = theme.appearance
}

interface ThemeStore {
  /** A theme id, or 'auto' to follow the OS. */
  selection: string
  theme: Theme
  /** Current terminal palette — terminals subscribe to this. */
  xterm: ITheme
  /** Apply a stored selection at startup (no persist). */
  init: (selection: string) => void
  /** Switch theme; persists unless `persist` is false (used for live preview). */
  select: (selection: string, persist?: boolean) => void
}

export const useThemeStore = create<ThemeStore>((set, get) => {
  const resolved = (selection: string): { selection: string; theme: Theme; xterm: ITheme } => {
    const theme = resolveTheme(selection, systemDark())
    paint(theme)
    return { selection, theme, xterm: theme.terminal }
  }

  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (get().selection === 'auto') set(resolved('auto'))
    })
  }

  const start = THEME_MAP[DEFAULT_THEME_ID]
  return {
    selection: DEFAULT_THEME_ID,
    theme: start,
    xterm: start.terminal,
    init: (selection) => set(resolved(selection)),
    select: (selection, persist = true) => {
      set(resolved(selection))
      if (persist) void window.dockterm.invoke('settings:set', { theme: selection })
    }
  }
})
