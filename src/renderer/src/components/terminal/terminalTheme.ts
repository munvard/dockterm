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

/** Curated monospace fonts for the Settings font picker. `value` is the CSS
 * font stack (`''` = use the bundled default, stored as null). */
export const FONT_CHOICES: { label: string; value: string }[] = [
  { label: 'Default (bundled mono)', value: '' },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', 'Cascadia Mono', monospace" },
  { label: 'SF Mono', value: "'SF Mono', monospace" },
  { label: 'Menlo', value: 'Menlo, monospace' },
  { label: 'Monaco', value: 'Monaco, monospace' },
  { label: 'Consolas', value: 'Consolas, monospace' },
  { label: 'Fira Code', value: "'Fira Code', monospace" },
  { label: 'Hack', value: "'Hack', monospace" },
  { label: 'Source Code Pro', value: "'Source Code Pro', monospace" },
  { label: 'IBM Plex Mono', value: "'IBM Plex Mono', monospace" },
  { label: 'Ubuntu Mono', value: "'Ubuntu Mono', monospace" },
  { label: 'Courier New', value: "'Courier New', monospace" }
]
