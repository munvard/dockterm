import type { editor } from 'monaco-editor'
import type { Theme } from '../../state/themes'

const noHash = (c: string): string => c.replace('#', '')

/** Build a Monaco theme from an app Theme so the editor matches the chosen
 * palette (UI colors + the terminal's ANSI colors for syntax). */
export function buildMonacoTheme(theme: Theme): editor.IStandaloneThemeData {
  const u = theme.ui
  const t = theme.terminal
  const tk = (c: string | undefined, fallback: string): string => noHash(c ?? fallback)
  return {
    base: theme.appearance === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: noHash(u['text-faint']), fontStyle: 'italic' },
      { token: 'keyword', foreground: tk(t.magenta, u.accent) },
      { token: 'string', foreground: tk(t.green, u.accent) },
      { token: 'number', foreground: tk(t.yellow, u.accent) },
      { token: 'regexp', foreground: tk(t.cyan, u.accent) },
      { token: 'type', foreground: tk(t.cyan, u.accent) },
      { token: 'type.identifier', foreground: tk(t.cyan, u.accent) },
      { token: 'function', foreground: tk(t.blue, u.accent) },
      { token: 'variable', foreground: noHash(u.text) },
      { token: 'constant', foreground: tk(t.yellow, u.accent) },
      { token: 'tag', foreground: tk(t.blue, u.accent) },
      { token: 'attribute.name', foreground: tk(t.magenta, u.accent) },
      { token: 'delimiter', foreground: noHash(u['text-dim']) }
    ],
    colors: {
      'editor.background': u.bg,
      'editor.foreground': u.text,
      'editorLineNumber.foreground': u['text-faint'],
      'editorLineNumber.activeForeground': u['text-dim'],
      'editor.selectionBackground': u.accent + '44',
      'editor.inactiveSelectionBackground': u.accent + '22',
      'editor.lineHighlightBackground': u.raised,
      'editor.lineHighlightBorder': '#00000000',
      'editorCursor.foreground': u.accent,
      'editorIndentGuide.background1': u.overlay,
      'editorIndentGuide.activeBackground1': u['border-strong'],
      'editorWhitespace.foreground': u.border,
      'editorGutter.background': u.bg,
      'editorWidget.background': u.panel,
      'editorWidget.border': u.border,
      'editorSuggestWidget.background': u.panel,
      'editorSuggestWidget.selectedBackground': u.accent + '22',
      'input.background': u.bg,
      'scrollbarSlider.background': u['border-strong'] + '80',
      'scrollbarSlider.hoverBackground': u['border-strong'] + 'aa',
      'editorOverviewRuler.border': '#00000000'
    }
  }
}
