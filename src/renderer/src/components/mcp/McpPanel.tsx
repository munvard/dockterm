import { useEffect } from 'react'
import { RefreshCw, ShieldAlert, Plus, FileJson, Copy, Server } from 'lucide-react'
import { useClaudeStore } from '../../state/useClaudeStore'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useToastStore } from '../../state/useToastStore'
import { PathOverride } from '../common/PathOverride'
import type { McpServerView } from '@shared/types'

const MASK = '••••'

function addSnippet(server: McpServerView): string {
  if (server.transport === 'http' || server.transport === 'sse') {
    return `claude mcp add --transport ${server.transport} ${server.name} ${server.url ?? '<url>'}`
  }
  return `claude mcp add ${server.name} -- ${server.command ?? '<command>'}`
}

export function McpPanel() {
  const mcp = useClaudeStore((s) => s.mcp)
  const read = useClaudeStore((s) => s.readMcp)
  const createTemplate = useClaudeStore((s) => s.createMcpTemplate)
  const settings = useAppStore((s) => s.settings)
  const updatePrefs = useAppStore((s) => s.updatePreferences)
  const openFile = useEditorStore((s) => s.open)
  const toast = useToastStore((s) => s.push)

  useEffect(() => {
    void read()
  }, [read])

  const readUserConfig = settings?.claude.readUserConfig ?? false
  const projectSource = mcp?.sources.find((s) => s.scope === 'project')
  const hasProjectFile = projectSource?.exists ?? false
  const servers = mcp?.servers ?? []
  const errors = mcp?.sources.filter((s) => !s.ok) ?? []

  const toggleUser = async () => {
    if (!settings) return
    await updatePrefs({ claude: { ...settings.claude, readUserConfig: !readUserConfig } })
    await read()
  }
  const setMcpPath = async (v: string): Promise<void> => {
    if (!settings) return
    await updatePrefs({ claude: { ...settings.claude, paths: { ...settings.claude.paths, mcpConfig: v } } })
    await read()
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Copy failed', 'error')
    }
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">MCP Servers</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void read()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        <p className="mcp-edu">MCP servers connect Claude Code to tools, data sources, and APIs.</p>
        <div className="mcp-warn">
          <ShieldAlert size={14} />
          <span>
            Only use MCP servers you trust — external content can carry prompt-injection risk.
            DockTerm only reads this config; it never runs them.
          </span>
        </div>
        <label className="mcp-toggle">
          <input type="checkbox" checked={readUserConfig} onChange={() => void toggleUser()} />
          Include servers from ~/.claude.json (your user &amp; local-scope servers)
        </label>

        {errors.map((e) => (
          <div key={e.path} className="mcp-error">
            Couldn&apos;t parse {e.scope} config: {e.error}
          </div>
        ))}

        {servers.length === 0 ? (
          <div className="mcp-empty">
            No MCP servers configured{readUserConfig ? '' : ' for this project'}.
          </div>
        ) : (
          servers.map((server) => (
            <div className="mcp-card" key={`${server.scope}-${server.name}`}>
              <div className="mcp-card__head">
                <Server size={13} className="mcp-card__icon" />
                <span className="mcp-card__name">{server.name}</span>
                <span className={`mcp-tag mcp-tag--${server.transport}`}>{server.transport}</span>
                <span className="mcp-tag mcp-tag--scope">{server.scope}</span>
              </div>
              {server.command && <code className="mcp-card__cmd">{server.command}</code>}
              {server.url && <code className="mcp-card__cmd">{server.url}</code>}
              {(server.envKeys.length > 0 || server.headerKeys.length > 0) && (
                <div className="mcp-secrets">
                  {server.envKeys.map((k) => (
                    <span key={`e-${k}`} className="mcp-secret">
                      {k}={MASK}
                    </span>
                  ))}
                  {server.headerKeys.map((k) => (
                    <span key={`h-${k}`} className="mcp-secret">
                      {k}: {MASK}
                    </span>
                  ))}
                </div>
              )}
              {(server.scope === 'project' || server.scope === 'user' || server.scope === 'local') && (
                <button className="git-linkbtn mcp-card__copy" onClick={() => void copy(addSnippet(server))}>
                  <Copy size={11} /> Copy add command
                </button>
              )}
            </div>
          ))
        )}

        <div className="panel-custom">
          <div className="panel-custom__title">Custom config</div>
          <PathOverride
            label="Extra .mcp.json"
            value={settings?.claude.paths.mcpConfig ?? ''}
            placeholder="path to a .mcp.json"
            pickDir={false}
            onChange={(v) => void setMcpPath(v)}
          />
        </div>
      </div>
      <div className="git-commit">
        {hasProjectFile ? (
          <button className="btn btn--ghost btn--sm" onClick={() => void openFile('.mcp.json', '.mcp.json')}>
            <FileJson size={13} /> Open .mcp.json
          </button>
        ) : (
          <button
            className="btn btn--ghost btn--sm"
            onClick={async () => {
              const relPath = await createTemplate()
              if (relPath) {
                await read()
                void openFile(relPath, '.mcp.json')
              }
            }}
          >
            <Plus size={13} /> Create .mcp.json
          </button>
        )}
      </div>
    </div>
  )
}
