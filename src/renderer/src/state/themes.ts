import type { ITheme } from '@xterm/xterm'

/** A cohesive theme: CSS-variable overrides for the UI + an xterm palette. */
export interface Theme {
  id: string
  name: string
  appearance: 'dark' | 'light'
  /** CSS custom properties (without the leading `--`). */
  ui: Record<string, string>
  terminal: ITheme
}

interface Palette {
  appearance: 'dark' | 'light'
  bg: string
  panel: string
  raised: string
  overlay: string
  border: string
  borderStrong: string
  text: string
  textDim: string
  textFaint: string
  accent: string
  accentHover: string
  onAccent: string
  // ANSI 16
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brBlack: string
  brRed: string
  brGreen: string
  brYellow: string
  brBlue: string
  brMagenta: string
  brCyan: string
  brWhite: string
}

/** #rrggbb + alpha → rgba(). */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function make(id: string, name: string, p: Palette): Theme {
  return {
    id,
    name,
    appearance: p.appearance,
    ui: {
      bg: p.bg,
      panel: p.panel,
      raised: p.raised,
      overlay: p.overlay,
      border: p.border,
      'border-strong': p.borderStrong,
      text: p.text,
      'text-dim': p.textDim,
      'text-faint': p.textFaint,
      accent: p.accent,
      'accent-hover': p.accentHover,
      'accent-soft': alpha(p.accent, 0.16),
      'on-accent': p.onAccent,
      success: p.green,
      warning: p.yellow,
      danger: p.red,
      'danger-soft': alpha(p.red, 0.14),
      'success-soft': alpha(p.green, 0.12)
    },
    terminal: {
      background: p.bg,
      foreground: p.text,
      cursor: p.accent,
      cursorAccent: p.bg,
      selectionBackground: alpha(p.accent, 0.3),
      black: p.black,
      red: p.red,
      green: p.green,
      yellow: p.yellow,
      blue: p.blue,
      magenta: p.magenta,
      cyan: p.cyan,
      white: p.white,
      brightBlack: p.brBlack,
      brightRed: p.brRed,
      brightGreen: p.brGreen,
      brightYellow: p.brYellow,
      brightBlue: p.brBlue,
      brightMagenta: p.brMagenta,
      brightCyan: p.brCyan,
      brightWhite: p.brWhite
    }
  }
}

export const THEMES: Theme[] = [
  make('dockterm-graphite', 'DockTerm Graphite', {
    appearance: 'dark',
    bg: '#1e1e1d', panel: '#252524', raised: '#2d2d2b', overlay: '#353532',
    border: '#34342f', borderStrong: '#45453e',
    text: '#e8e8e3', textDim: '#a2a29a', textFaint: '#6f6f67',
    accent: '#7c6bff', accentHover: '#8d7dff', onAccent: '#ffffff',
    black: '#2a2a27', red: '#f87171', green: '#4ade80', yellow: '#fbbf24',
    blue: '#5b8aff', magenta: '#a78bfa', cyan: '#2dd4bf', white: '#c8c8c2',
    brBlack: '#4a4a44', brRed: '#fb9a9a', brGreen: '#86efac', brYellow: '#fde68a',
    brBlue: '#93b4ff', brMagenta: '#c4b5fd', brCyan: '#5eead4', brWhite: '#f4f4ef'
  }),
  make('dockterm-dark', 'DockTerm Dark', {
    appearance: 'dark',
    bg: '#0d0d0f', panel: '#131318', raised: '#1a1a21', overlay: '#1f1f29',
    border: '#26262e', borderStrong: '#34343f',
    text: '#e8e8ed', textDim: '#a0a0ab', textFaint: '#6b6b76',
    accent: '#7c6bff', accentHover: '#8d7dff', onAccent: '#ffffff',
    black: '#15151b', red: '#f87171', green: '#4ade80', yellow: '#fbbf24',
    blue: '#5b8aff', magenta: '#a78bfa', cyan: '#2dd4bf', white: '#c8c8d0',
    brBlack: '#3a3a45', brRed: '#fb9a9a', brGreen: '#86efac', brYellow: '#fde68a',
    brBlue: '#93b4ff', brMagenta: '#c4b5fd', brCyan: '#5eead4', brWhite: '#f4f4f7'
  }),
  // A warm "paper" light — intentionally NOT white, so it reads distinctly from
  // the cool GitHub Light. Cream surfaces, soft taupe borders, violet accent.
  make('dockterm-light', 'DockTerm Paper', {
    appearance: 'light',
    bg: '#f7f3ea', panel: '#efe9db', raised: '#e7dfcd', overlay: '#ded4be',
    border: '#ddd2bc', borderStrong: '#c6b89c',
    text: '#2c271d', textDim: '#6c6353', textFaint: '#9a907c',
    accent: '#7c5cff', accentHover: '#6a4cf0', onAccent: '#ffffff',
    black: '#2c271d', red: '#c4453f', green: '#5a8f3c', yellow: '#a87a00',
    blue: '#3b6ad8', magenta: '#8b5cf6', cyan: '#0e8f86', white: '#6c6353',
    brBlack: '#9a907c', brRed: '#d8574f', brGreen: '#6fa84e', brYellow: '#bd8c00',
    brBlue: '#5a86f5', brMagenta: '#a07bf8', brCyan: '#1cae9f', brWhite: '#2c271d'
  }),
  make('tokyo-night', 'Tokyo Night', {
    appearance: 'dark',
    bg: '#1a1b26', panel: '#1d1e2c', raised: '#24283b', overlay: '#2a2e42',
    border: '#2f3450', borderStrong: '#3b4261',
    text: '#c0caf5', textDim: '#9aa5ce', textFaint: '#565f89',
    accent: '#7aa2f7', accentHover: '#8db0f9', onAccent: '#1a1b26',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
    blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brBlack: '#414868', brRed: '#f7768e', brGreen: '#9ece6a', brYellow: '#e0af68',
    brBlue: '#7aa2f7', brMagenta: '#bb9af7', brCyan: '#7dcfff', brWhite: '#c0caf5'
  }),
  make('catppuccin-mocha', 'Catppuccin Mocha', {
    appearance: 'dark',
    bg: '#1e1e2e', panel: '#181825', raised: '#313244', overlay: '#45475a',
    border: '#313244', borderStrong: '#45475a',
    text: '#cdd6f4', textDim: '#a6adc8', textFaint: '#7f849c',
    accent: '#cba6f7', accentHover: '#d4b5f9', onAccent: '#1e1e2e',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brBlack: '#585b70', brRed: '#f38ba8', brGreen: '#a6e3a1', brYellow: '#f9e2af',
    brBlue: '#89b4fa', brMagenta: '#f5c2e7', brCyan: '#94e2d5', brWhite: '#a6adc8'
  }),
  make('nord', 'Nord', {
    appearance: 'dark',
    bg: '#2e3440', panel: '#2b303b', raised: '#3b4252', overlay: '#434c5e',
    border: '#3b4252', borderStrong: '#4c566a',
    text: '#eceff4', textDim: '#d8dee9', textFaint: '#7b88a1',
    accent: '#88c0d0', accentHover: '#8fbcbb', onAccent: '#2e3440',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brBlack: '#4c566a', brRed: '#bf616a', brGreen: '#a3be8c', brYellow: '#ebcb8b',
    brBlue: '#81a1c1', brMagenta: '#b48ead', brCyan: '#8fbcbb', brWhite: '#eceff4'
  }),
  make('rose-pine', 'Rosé Pine', {
    appearance: 'dark',
    bg: '#191724', panel: '#1f1d2e', raised: '#26233a', overlay: '#2a2740',
    border: '#26233a', borderStrong: '#403d52',
    text: '#e0def4', textDim: '#908caa', textFaint: '#6e6a86',
    accent: '#c4a7e7', accentHover: '#d0b8ec', onAccent: '#191724',
    black: '#26233a', red: '#eb6f92', green: '#3e8fb0', yellow: '#f6c177',
    blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
    brBlack: '#6e6a86', brRed: '#eb6f92', brGreen: '#3e8fb0', brYellow: '#f6c177',
    brBlue: '#9ccfd8', brMagenta: '#c4a7e7', brCyan: '#ebbcba', brWhite: '#e0def4'
  }),
  // Linux/Ubuntu "Aubergine": the classic #300924 deep-plum desktop with the
  // Ubuntu-orange accent. Warm purple surfaces, vivid orange highlights.
  make('aubergine', 'Aubergine', {
    appearance: 'dark',
    bg: '#300924', panel: '#3a0f2c', raised: '#471637', overlay: '#551d44',
    border: '#4d1a3d', borderStrong: '#642a54',
    text: '#f5e6ef', textDim: '#cba6bd', textFaint: '#9a7589',
    accent: '#e95420', accentHover: '#f26a3a', onAccent: '#ffffff',
    black: '#3a0f2c', red: '#ff6188', green: '#7bd88f', yellow: '#ffd866',
    blue: '#7aa2f7', magenta: '#c792ea', cyan: '#5ad4c4', white: '#e8d3df',
    brBlack: '#7a5068', brRed: '#ff7a9c', brGreen: '#97e6a8', brYellow: '#ffe08a',
    brBlue: '#9ab8ff', brMagenta: '#d8aef0', brCyan: '#7fe3d6', brWhite: '#fbeff5'
  }),
  make('gruvbox-dark', 'Gruvbox Dark', {
    appearance: 'dark',
    bg: '#1d2021', panel: '#282828', raised: '#32302f', overlay: '#3c3836',
    border: '#3c3836', borderStrong: '#504945',
    text: '#ebdbb2', textDim: '#bdae93', textFaint: '#928374',
    accent: '#fabd2f', accentHover: '#fcc847', onAccent: '#1d2021',
    black: '#282828', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f',
    blue: '#83a598', magenta: '#d3869b', cyan: '#8ec07c', white: '#d5c4a1',
    brBlack: '#504945', brRed: '#fb4934', brGreen: '#b8bb26', brYellow: '#fabd2f',
    brBlue: '#83a598', brMagenta: '#d3869b', brCyan: '#8ec07c', brWhite: '#ebdbb2'
  }),
  make('github-light', 'GitHub Light', {
    appearance: 'light',
    bg: '#ffffff', panel: '#f6f8fa', raised: '#eaeef2', overlay: '#e1e6eb',
    border: '#d0d7de', borderStrong: '#afb8c1',
    text: '#1f2328', textDim: '#636c76', textFaint: '#8c959f',
    accent: '#0969da', accentHover: '#0a6fe0', onAccent: '#ffffff',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700',
    blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brBlack: '#57606a', brRed: '#a40e26', brGreen: '#1a7f37', brYellow: '#7d4e00',
    brBlue: '#218bff', brMagenta: '#a475f9', brCyan: '#3192aa', brWhite: '#8c959f'
  })
]

export const THEME_MAP: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]))

export const DEFAULT_THEME_ID = 'dockterm-graphite'
const DEFAULT_LIGHT_ID = 'dockterm-light'

/** Resolve a stored selection (a theme id, or 'auto') to a concrete theme. */
export function resolveTheme(selection: string, systemDark: boolean): Theme {
  if (selection === 'auto') {
    return THEME_MAP[systemDark ? DEFAULT_THEME_ID : DEFAULT_LIGHT_ID]
  }
  return THEME_MAP[selection] ?? THEME_MAP[DEFAULT_THEME_ID]
}
