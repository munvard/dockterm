import type { ITheme } from '@xterm/xterm'

/** xterm ANSI theme tuned to share DockTerm's palette (tokens.css). */
export const terminalTheme: ITheme = {
  background: '#0d0d0f',
  foreground: '#e8e8ed',
  cursor: '#7c6bff',
  cursorAccent: '#0d0d0f',
  selectionBackground: 'rgba(124, 107, 255, 0.30)',
  black: '#15151b',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#5b8aff',
  magenta: '#a78bfa',
  cyan: '#2dd4bf',
  white: '#c8c8d0',
  brightBlack: '#3a3a45',
  brightRed: '#fb9a9a',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93b4ff',
  brightMagenta: '#c4b5fd',
  brightCyan: '#5eead4',
  brightWhite: '#f4f4f7'
}

export const DEFAULT_MONO =
  '"JetBrains Mono", "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace'
