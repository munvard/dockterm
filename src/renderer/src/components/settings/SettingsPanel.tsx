import type { ReactNode } from 'react'
import { useAppStore } from '../../state/useAppStore'
import { useThemeStore } from '../../state/useThemeStore'
import { THEMES } from '../../state/themes'
import type { CursorStyle, TerminalRenderer, Settings } from '@shared/types'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section__title">{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <span className="settings-field__label">{label}</span>
      <div className="settings-field__control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle${checked ? ' toggle--on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  )
}

function clampNum(value: string, lo: number, hi: number, fallback: number): number {
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}

export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updatePreferences)
  const setZoom = useAppStore((s) => s.setZoom)
  const themeSel = useThemeStore((st) => st.selection)
  const selectTheme = useThemeStore((st) => st.select)
  if (!settings) return null
  const s = settings
  const zoom = s.ui.zoom ?? 1.1

  const setTerminal = (patch: Partial<Settings['terminal']>) =>
    void update({ terminal: { ...s.terminal, ...patch } })
  const setEditor = (patch: Partial<Settings['editor']>) =>
    void update({ editor: { ...s.editor, ...patch } })
  const setGit = (patch: Partial<Settings['git']>) => void update({ git: { ...s.git, ...patch } })

  const resetDefaults = () => {
    selectTheme('dockterm-dark')
    void update({
      terminal: {
        fontFamily: null,
        fontSize: 13,
        cursorStyle: 'block',
        cursorBlink: true,
        renderer: 'auto',
        scrollback: 5000
      },
      editor: { fontSize: 13 },
      git: { beginnerMode: true, confirmDanger: true },
      claude: { readUserConfig: false }
    })
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Settings</span>
      </div>
      <div className="panel__body settings">
        <Section title="Appearance">
          <Field label="UI scale">
            <div className="stepper">
              <button
                className="stepper__btn"
                title="Smaller (⌘−)"
                disabled={zoom <= 0.7}
                onClick={() => void setZoom(zoom - 0.1)}
              >
                −
              </button>
              <span className="stepper__value">{Math.round(zoom * 100)}%</span>
              <button
                className="stepper__btn"
                title="Bigger (⌘+)"
                disabled={zoom >= 2}
                onClick={() => void setZoom(zoom + 0.1)}
              >
                +
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => void setZoom(1)}>
                Reset
              </button>
            </div>
          </Field>
          <div className="settings-note">
            Scales the whole app — chrome, terminals and the editor. Shortcuts: ⌘+ / ⌘− / ⌘0.
          </div>
        </Section>

        <Section title="Theme">
          <div className="theme-grid">
            <button
              className={`theme-swatch theme-swatch--auto${themeSel === 'auto' ? ' is-active' : ''}`}
              onClick={() => selectTheme('auto')}
              title="Match system appearance"
            >
              <span className="theme-swatch__name">Auto · system</span>
            </button>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`theme-swatch${themeSel === t.id ? ' is-active' : ''}`}
                style={{
                  background: t.ui.bg,
                  borderColor: themeSel === t.id ? t.ui.accent : t.ui.border
                }}
                onClick={() => selectTheme(t.id)}
                title={t.name}
              >
                <span className="theme-swatch__dots">
                  <span style={{ background: t.ui.accent }} />
                  <span style={{ background: t.terminal.green }} />
                  <span style={{ background: t.terminal.red }} />
                </span>
                <span className="theme-swatch__name" style={{ color: t.ui.text }}>
                  {t.name}
                </span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Terminal">
          <Field label="Font family">
            <input
              className="settings-input"
              value={s.terminal.fontFamily ?? ''}
              placeholder="Default mono"
              spellCheck={false}
              onChange={(e) => setTerminal({ fontFamily: e.target.value.trim() || null })}
            />
          </Field>
          <Field label="Font size">
            <input
              className="settings-num"
              type="number"
              min={8}
              max={32}
              value={s.terminal.fontSize}
              onChange={(e) => setTerminal({ fontSize: clampNum(e.target.value, 8, 32, 13) })}
            />
          </Field>
          <Field label="Cursor">
            <select
              className="settings-select"
              value={s.terminal.cursorStyle}
              onChange={(e) => setTerminal({ cursorStyle: e.target.value as CursorStyle })}
            >
              <option value="block">Block</option>
              <option value="bar">Bar</option>
              <option value="underline">Underline</option>
            </select>
          </Field>
          <Field label="Cursor blink">
            <Toggle checked={s.terminal.cursorBlink} onChange={(v) => setTerminal({ cursorBlink: v })} />
          </Field>
          <Field label="Renderer">
            <select
              className="settings-select"
              value={s.terminal.renderer}
              onChange={(e) => setTerminal({ renderer: e.target.value as TerminalRenderer })}
            >
              <option value="auto">Auto (WebGL)</option>
              <option value="dom">DOM (compatible)</option>
            </select>
          </Field>
        </Section>

        <Section title="Editor">
          <Field label="Font size">
            <input
              className="settings-num"
              type="number"
              min={8}
              max={32}
              value={s.editor.fontSize}
              onChange={(e) => setEditor({ fontSize: clampNum(e.target.value, 8, 32, 13) })}
            />
          </Field>
        </Section>

        <Section title="Git">
          <Field label="Beginner mode">
            <Toggle checked={s.git.beginnerMode} onChange={(v) => setGit({ beginnerMode: v })} />
          </Field>
          <Field label="Confirm destructive actions">
            <Toggle checked={s.git.confirmDanger} onChange={(v) => setGit({ confirmDanger: v })} />
          </Field>
        </Section>

        <Section title="Claude config">
          <Field label="Read my user config">
            <Toggle
              checked={s.claude.readUserConfig}
              onChange={(v) => void update({ claude: { ...s.claude, readUserConfig: v } })}
            />
          </Field>
          <div className="settings-note">
            Off by default. ~/.claude can contain tokens — DockTerm masks them and only reads when
            this is on.
          </div>
        </Section>

        <Section title="Reset">
          <button className="btn btn--ghost btn--sm" onClick={resetDefaults}>
            Reset preferences to defaults
          </button>
        </Section>
      </div>
    </div>
  )
}
