import { useEffect } from 'react'
import { RefreshCw, Bot } from 'lucide-react'
import { useClaudeStore } from '../../state/useClaudeStore'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { PathOverride } from '../common/PathOverride'

function fileName(path: string): string {
  return path.split('/').pop() ?? path
}

export function AgentsPanel() {
  const agents = useClaudeStore((s) => s.agents)
  const read = useClaudeStore((s) => s.readAgents)
  const settings = useAppStore((s) => s.settings)
  const updatePrefs = useAppStore((s) => s.updatePreferences)
  const openFile = useEditorStore((s) => s.open)

  useEffect(() => {
    void read()
  }, [read])

  const readUserConfig = settings?.claude.readUserConfig ?? false
  const toggleUser = async (): Promise<void> => {
    if (!settings) return
    await updatePrefs({ claude: { ...settings.claude, readUserConfig: !readUserConfig } })
    await read()
  }
  const setAgentsPath = async (v: string): Promise<void> => {
    if (!settings) return
    await updatePrefs({ claude: { ...settings.claude, paths: { ...settings.claude.paths, agents: v } } })
    await read()
  }

  const list = agents?.agents ?? []

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Agents</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void read()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        <label className="mcp-toggle">
          <input type="checkbox" checked={readUserConfig} onChange={() => void toggleUser()} />
          Include user &amp; plugin agents (~/.claude)
        </label>

        {list.length === 0 && (
          <div className="mcp-empty">
            No subagents found{readUserConfig ? '' : ' in this project'}.
            {!readUserConfig && (
              <>
                {' '}
                <button className="linkbtn" onClick={() => void toggleUser()}>
                  Include your user &amp; plugin agents
                </button>{' '}
                to see global ones.
              </>
            )}
          </div>
        )}

        {list.map((a) => (
          <div
            className={`skill-row${a.canOpen ? '' : ' skill-row--readonly'}`}
            key={`${a.scope}-${a.name}-${a.sourcePath}`}
            onClick={() => a.canOpen && void openFile(a.sourcePath, fileName(a.sourcePath))}
            title={a.sourcePath}
          >
            <Bot size={13} className="skill-row__icon" />
            <div className="skill-row__body">
              <div className="skill-row__name">
                {a.name}
                <span className="skill-row__scope">{a.scope}</span>
              </div>
              {a.description && <div className="skill-row__desc">{a.description}</div>}
            </div>
          </div>
        ))}

        <div className="panel-custom">
          <div className="panel-custom__title">Custom folder</div>
          <PathOverride
            label="Agents folder"
            value={settings?.claude.paths.agents ?? ''}
            onChange={(v) => void setAgentsPath(v)}
          />
        </div>
      </div>
    </div>
  )
}
