import { useState, type ReactNode } from 'react'
import { useAppStore } from '../../state/useAppStore'
import { useToastStore } from '../../state/useToastStore'
import { useThemeStore } from '../../state/useThemeStore'
import { THEMES } from '../../state/themes'
import { DEFAULT_MONO, FONT_CHOICES } from '../terminal/terminalTheme'
import type { CursorStyle, TerminalRenderer, Settings } from '@shared/types'
import { CHARACTERS } from '../munu/mascots'
import { Munu } from '../munu/Munu'

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
  const setMunu = (patch: Partial<Settings['munu']>) => void update({ munu: { ...s.munu, ...patch } })
  const setActivity = (patch: Partial<Settings['agentActivity']>) =>
    void update({ agentActivity: { ...s.agentActivity, ...patch } })
  const setClaude = (patch: Partial<Settings['claude']>) =>
    void update({ claude: { ...s.claude, ...patch } })

  // Font picker: a known stack matches a preset; anything else is "custom".
  const fontValue = s.terminal.fontFamily
  const matchedFont = FONT_CHOICES.find((f) => f.value === (fontValue ?? ''))
  const [customFont, setCustomFont] = useState(fontValue !== null && !matchedFont)

  const checkUpdates = async (): Promise<void> => {
    const res = await window.dockterm.invoke('update:check', undefined)
    if (res.ok && res.value.upToDate) {
      useToastStore.getState().push("You're on the latest version.", 'success')
    }
  }

  const resetDefaults = () => {
    selectTheme('dockterm-dark')
    void update({
      terminal: {
        fontFamily: null,
        fontSize: 13,
        cursorStyle: 'block',
        cursorBlink: true,
        renderer: 'auto',
        scrollback: 5000,
        shellIntegration: true,
        claudeButtons: true,
        copyOnSelect: false,
        selectionToolbar: true,
        restoreScrollback: true,
        changesOverlay: true,
        composeOverlay: true,
        filePreviews: true,
        claudeFullscreen: false
      },
      editor: { fontSize: 13 },
      git: { beginnerMode: true, confirmDanger: true },
      claude: {
        readUserConfig: false,
        paths: { skills: '', commands: '', agents: '', mcpConfig: '' }
      }
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
            <select
              className="settings-select"
              value={customFont ? '__custom__' : (fontValue ?? '')}
              onChange={(e) => {
                const v = e.target.value
                if (v === '__custom__') {
                  setCustomFont(true)
                } else {
                  setCustomFont(false)
                  setTerminal({ fontFamily: v === '' ? null : v })
                }
              }}
            >
              {FONT_CHOICES.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
          </Field>
          {customFont && (
            <Field label="Custom font">
              <input
                className="settings-input"
                value={fontValue ?? ''}
                placeholder="'My Font', monospace"
                spellCheck={false}
                onChange={(e) => setTerminal({ fontFamily: e.target.value || null })}
              />
            </Field>
          )}
          <div className="settings-note settings-fontpreview" style={{ fontFamily: fontValue ?? DEFAULT_MONO }}>
            const munu = () =&gt; ‹ 0 O o · i l 1 · {'{}'} ›
          </div>
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
          <Field label="Track directory (shell integration)">
            <Toggle
              checked={s.terminal.shellIntegration}
              onChange={(v) => setTerminal({ shellIntegration: v })}
            />
          </Field>
          <div className="settings-note">
            Lets the Files/Git panels follow the focused terminal as you <code>cd</code>. Adds a
            tiny hook to zsh/bash/PowerShell sessions. Restart a terminal after changing this.
          </div>
          <Field label="Start-Claude / Resume buttons">
            <Toggle
              checked={s.terminal.claudeButtons}
              onChange={(v) => setTerminal({ claudeButtons: v })}
            />
          </Field>
          <Field label="Claude Code fullscreen TUI">
            <Toggle
              checked={s.terminal.claudeFullscreen}
              onChange={(v) => setTerminal({ claudeFullscreen: v })}
            />
          </Field>
          <div className="settings-note">
            Off (default): Claude scrolls inline like a normal terminal and respects its own{' '}
            <code>/tui</code> setting. On: the flicker-free fullscreen TUI that takes over the
            screen with its own scrolling. Start a new Claude session after changing this.
          </div>
          <Field label="Selection “Send to Claude” toolbar">
            <Toggle
              checked={s.terminal.selectionToolbar}
              onChange={(v) => setTerminal({ selectionToolbar: v })}
            />
          </Field>
          <Field label="Copy on select">
            <Toggle
              checked={s.terminal.copyOnSelect}
              onChange={(v) => setTerminal({ copyOnSelect: v })}
            />
          </Field>
          <Field label="Restore scrollback after quit">
            <Toggle
              checked={s.terminal.restoreScrollback}
              onChange={(v) => setTerminal({ restoreScrollback: v })}
            />
          </Field>
          <div className="settings-note">
            Brings back each terminal’s on-screen history when you reopen DockTerm (the live
            processes can’t be restored — use <code>claude --resume</code> to continue).
          </div>
          <Field label="Compose editor for long prompts">
            <Toggle
              checked={s.terminal.composeOverlay}
              onChange={(v) => setTerminal({ composeOverlay: v })}
            />
          </Field>
          <div className="settings-note">
            Press <code>⌘⇧⏎</code> to write a long prompt in a roomy editor, then Insert or Send it
            into Claude.
          </div>
          <Field label="Hover file previews">
            <Toggle
              checked={s.terminal.filePreviews}
              onChange={(v) => setTerminal({ filePreviews: v })}
            />
          </Field>
          <div className="settings-note">
            Hover a file path in the terminal to peek at it (image, markdown, or code).
          </div>
          <Field label="Live “Changes” overlay">
            <Toggle
              checked={s.terminal.changesOverlay}
              onChange={(v) => setTerminal({ changesOverlay: v })}
            />
          </Field>
          <div className="settings-note">
            Adds a Changes button to each terminal’s controls — a floating panel listing the files
            changed in that terminal’s project; expand a row to see the diff or the full file. It
            only opens when you click the button.
          </div>
        </Section>

        <Section title="Checkpoints (history)">
          <Field label="Show the checkpoints rail">
            <Toggle
              checked={s.sessionHistory.enabled}
              onChange={(v) => void update({ sessionHistory: { ...s.sessionHistory, enabled: v } })}
            />
          </Field>
          <Field label="Side">
            <select
              className="settings-select"
              value={s.sessionHistory.side}
              onChange={(e) =>
                void update({
                  sessionHistory: { ...s.sessionHistory, side: e.target.value as 'left' | 'right' }
                })
              }
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </Field>
          <div className="settings-note">
            Lists your prompts to Claude — click one to scroll back to it. “Rewind” opens Claude’s
            own <code>/rewind</code> so you confirm the restore. Toggle it from a terminal’s
            controls (the milestone icon).
          </div>
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

        <Section title="munu">
          <Field label="Character">
            <span className="settings-note settings-note--inline">
              pick who lives on your screen
            </span>
          </Field>
          <div className="char-grid">
            {CHARACTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`char-card${s.munu.character === c.id ? ' is-active' : ''}`}
                onClick={() => setMunu({ character: c.id })}
                title={c.blurb}
                aria-pressed={s.munu.character === c.id}
              >
                <Munu state="idle" character={c.id} size={48} />
                <span className="char-card__name">{c.label}</span>
              </button>
            ))}
          </div>
          <Field label="Enable munu">
            <Toggle checked={s.munu.enabled} onChange={(v) => setMunu({ enabled: v })} />
          </Field>
          <Field label="Floating overlay (notch / pill)">
            <Toggle checked={s.munu.overlay} onChange={(v) => setMunu({ overlay: v })} />
          </Field>
          <Field label="munu size">
            <select
              className="settings-select"
              value={s.munu.size}
              onChange={(e) => setMunu({ size: Number(e.target.value) })}
            >
              <option value={44}>Small</option>
              <option value={56}>Default</option>
              <option value={72}>Large</option>
              <option value={88}>Extra large</option>
            </select>
          </Field>
          <Field label="Pin to screen">
            <Toggle checked={s.munu.pinned} onChange={(v) => setMunu({ pinned: v })} />
          </Field>
          {s.munu.pinned && (
            <div className="settings-note">
              munu stays visible and can be dragged anywhere.{' '}
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setMunu({ position: null })}
              >
                Reset position
              </button>
            </div>
          )}
          <Field label="Sounds">
            <Toggle checked={s.munu.sounds} onChange={(v) => setMunu({ sounds: v })} />
          </Field>
          <Field label="Attention animation">
            <Toggle checked={s.munu.attention} onChange={(v) => setMunu({ attention: v })} />
          </Field>
          <Field label="Keep awake while Claude works">
            <Toggle checked={s.munu.keepAwake} onChange={(v) => setMunu({ keepAwake: v })} />
          </Field>
          <Field label="Notify when backgrounded">
            <Toggle checked={s.munu.notifications} onChange={(v) => setMunu({ notifications: v })} />
          </Field>
          <div className="settings-note">
            munu mirrors what Claude Code is doing. The floating pill stays visible over other
            apps and shows <code>[y/n]</code> when Claude needs you — it never auto-answers.
          </div>
        </Section>

        <Section title="Agent activity">
          <Field label="Show live agents">
            <Toggle checked={s.agentActivity.enabled} onChange={(v) => setActivity({ enabled: v })} />
          </Field>
          <Field label="Top-bar count pill">
            <Toggle checked={s.agentActivity.pill} onChange={(v) => setActivity({ pill: v })} />
          </Field>
          <Field label="Creature swarm under munu">
            <Toggle checked={s.agentActivity.swarm} onChange={(v) => setActivity({ swarm: v })} />
          </Field>
          <Field label="Read each agent's result">
            <Toggle
              checked={s.agentActivity.streamOutput}
              onChange={(v) => setActivity({ streamOutput: v })}
            />
          </Field>
          <div className="settings-note">
            When on, the Activity panel shows what each finished agent returned (read locally from
            your Claude Code transcripts, never sent anywhere). Turn off to show status only — type,
            timing, success/fail — with no message content.
          </div>
          <Field label="Sound when agents finish">
            <Toggle checked={s.agentActivity.sounds} onChange={(v) => setActivity({ sounds: v })} />
          </Field>
          <Field label="Notify when backgrounded">
            <Toggle
              checked={s.agentActivity.notifications}
              onChange={(v) => setActivity({ notifications: v })}
            />
          </Field>
          <div className="settings-note">
            Shows how many sub-agents Claude Code is running right now, what each is doing, and how
            long it took — live, grouped by project. The <b>Activity</b> panel and the count pill
            open it in detail.
          </div>
        </Section>

        <Section title="Git">
          <Field label="Beginner mode">
            <Toggle checked={s.git.beginnerMode} onChange={(v) => setGit({ beginnerMode: v })} />
          </Field>
          <div className="settings-note">
            Plain-language labels and extra guidance on Git actions. Turn off for a terser,
            power-user view.
          </div>
          <Field label="Confirm destructive actions">
            <Toggle checked={s.git.confirmDanger} onChange={(v) => setGit({ confirmDanger: v })} />
          </Field>
          <div className="settings-note">
            Ask before anything that can lose work (discard changes, delete a branch, force
            push), showing the exact command first.
          </div>
        </Section>

        <Section title="Claude config">
          <Field label="Read user config (MCP · skills · agents)">
            <Toggle checked={s.claude.readUserConfig} onChange={(v) => setClaude({ readUserConfig: v })} />
          </Field>
          <div className="settings-note">
            Off by default. When on, DockTerm also reads your global <code>~/.claude</code> and
            installed plugins so the MCP, Skills, and Agents panels show your user-scope and
            plugin items — read-only, with secrets always masked. Set a custom folder for each
            right inside its panel (Skills, Agents, MCP).
          </div>
        </Section>

        <Section title="Usage">
          <Field label="Show usage">
            <Toggle
              checked={s.usage.enabled}
              onChange={(v) => void update({ usage: { ...s.usage, enabled: v } })}
            />
          </Field>
          <div className="settings-note">
            Shows the exact number of tokens you’ve used in the last 5 hours and the last week,
            read from your local Claude Code sessions on this machine — plus when each window
            resets. Turn this off if you don’t use Claude Code here.
          </div>
        </Section>

        <Section title="Updates">
          <Field label="Check automatically">
            <Toggle
              checked={s.update.checkAutomatically}
              onChange={(v) => void update({ update: { ...s.update, checkAutomatically: v } })}
            />
          </Field>
          <Field label="Check now">
            <button className="btn btn--ghost btn--sm" onClick={() => void checkUpdates()}>
              Check for updates
            </button>
          </Field>
          <div className="settings-note">
            DockTerm checks GitHub on launch and every few hours, then offers a popup. It never
            installs anything on its own — “Update now” just opens the download page.
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
