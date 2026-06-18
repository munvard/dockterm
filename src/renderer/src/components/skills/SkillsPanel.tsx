import { useEffect, useState } from 'react'
import { RefreshCw, Sparkles, FileText, Plus, ChevronDown } from 'lucide-react'
import { useClaudeStore } from '../../state/useClaudeStore'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useDialogStore } from '../../state/useDialogStore'
import { PathOverride } from '../common/PathOverride'
import type { SkillTemplate } from '@shared/types'

const TEMPLATES: { id: SkillTemplate; label: string }[] = [
  { id: 'blank', label: 'Blank skill' },
  { id: 'brainstorming', label: 'Brainstorming' },
  { id: 'ultraplan', label: 'Ultraplan' },
  { id: 'review-changes', label: 'Review changes' },
  { id: 'safe-commit', label: 'Safe commit' }
]

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function SkillsPanel() {
  const skills = useClaudeStore((s) => s.skills)
  const read = useClaudeStore((s) => s.readSkills)
  const create = useClaudeStore((s) => s.createSkill)
  const settings = useAppStore((s) => s.settings)
  const updatePrefs = useAppStore((s) => s.updatePreferences)
  const openFile = useEditorStore((s) => s.open)
  const prompt = useDialogStore((s) => s.prompt)
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    void read()
  }, [read])

  const readUserConfig = settings?.claude.readUserConfig ?? false
  const toggleUser = async () => {
    if (!settings) return
    await updatePrefs({ claude: { ...settings.claude, readUserConfig: !readUserConfig } })
    await read()
  }
  const setPath = async (key: 'skills' | 'commands', v: string) => {
    if (!settings) return
    await updatePrefs({
      claude: { ...settings.claude, paths: { ...settings.claude.paths, [key]: v } }
    })
    await read()
  }

  const newFromTemplate = async (template: SkillTemplate) => {
    setMenu(false)
    const name = await prompt({
      title: 'New skill',
      label: 'Skill name',
      initial: template === 'blank' ? '' : template,
      confirmLabel: 'Create'
    })
    if (!name) return
    const relPath = await create(name, 'skill', template)
    if (relPath) {
      await read()
      void openFile(relPath, fileName(relPath))
    }
  }

  const newCommand = async () => {
    const name = await prompt({
      title: 'New command',
      label: 'Command name',
      placeholder: 'deploy',
      confirmLabel: 'Create'
    })
    if (!name) return
    const relPath = await create(name, 'command', 'blank')
    if (relPath) {
      await read()
      void openFile(relPath, fileName(relPath))
    }
  }

  const open = (path: string, canOpen: boolean) => {
    if (canOpen) void openFile(path, fileName(path))
  }

  const skillsList = skills?.skills ?? []
  const commandsList = skills?.commands ?? []
  const empty = skillsList.length === 0 && commandsList.length === 0

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Skills &amp; Commands</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void read()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        <label className="mcp-toggle">
          <input type="checkbox" checked={readUserConfig} onChange={() => void toggleUser()} />
          Include user &amp; plugin skills (~/.claude)
        </label>

        {empty && (
          <div className="mcp-empty">
            No skills or commands found{readUserConfig ? '' : ' in this project'}.
            {!readUserConfig && (
              <>
                {' '}
                <button className="linkbtn" onClick={() => void toggleUser()}>
                  Include your user &amp; plugin items
                </button>{' '}
                to see global ones.
              </>
            )}
          </div>
        )}

        {skillsList.length > 0 && (
          <div className="git-section">
            <div className="git-section__head">
              <span className="git-section__title">Skills</span>
            </div>
            {skillsList.map((s) => (
              <div
                className={`skill-row${s.canOpen ? '' : ' skill-row--readonly'}`}
                key={`${s.scope}-${s.slashName}`}
                onClick={() => open(s.sourcePath, s.canOpen)}
                title={s.canOpen ? s.sourcePath : s.sourcePath}
              >
                <Sparkles size={13} className="skill-row__icon" />
                <div className="skill-row__body">
                  <div className="skill-row__name">
                    /{s.slashName}
                    <span className="skill-row__scope">{s.scope}</span>
                  </div>
                  {s.description && <div className="skill-row__desc">{s.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {commandsList.length > 0 && (
          <div className="git-section">
            <div className="git-section__head">
              <span className="git-section__title">Commands</span>
            </div>
            {commandsList.map((c) => (
              <div
                className={`skill-row${c.canOpen ? '' : ' skill-row--readonly'}`}
                key={`${c.scope}-${c.slashName}`}
                onClick={() => open(c.sourcePath, c.canOpen)}
                title={c.sourcePath}
              >
                <FileText size={13} className="skill-row__icon" />
                <div className="skill-row__body">
                  <div className="skill-row__name">
                    /{c.slashName}
                    <span className="skill-row__scope">{c.scope}</span>
                  </div>
                  {c.description && <div className="skill-row__desc">{c.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="panel-custom">
          <div className="panel-custom__title">Custom folders</div>
          <PathOverride
            label="Skills folder"
            value={settings?.claude.paths.skills ?? ''}
            onChange={(v) => void setPath('skills', v)}
          />
          <PathOverride
            label="Commands folder"
            value={settings?.claude.paths.commands ?? ''}
            onChange={(v) => void setPath('commands', v)}
          />
        </div>
      </div>
      <div className="git-commit skill-actions">
        <div className="skill-newmenu-wrap">
          <button className="btn btn--ghost btn--sm" onClick={() => setMenu((v) => !v)}>
            <Plus size={13} /> New skill <ChevronDown size={12} />
          </button>
          {menu && (
            <div className="skill-menu" onMouseLeave={() => setMenu(false)}>
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => void newFromTemplate(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => void newCommand()}>
          <Plus size={13} /> Command
        </button>
      </div>
    </div>
  )
}
