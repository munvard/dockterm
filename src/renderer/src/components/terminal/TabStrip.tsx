import { useEffect, useRef, useState } from 'react'
import { Plus, X, LayoutGrid, ChevronDown, RotateCcw, ChevronsRight } from 'lucide-react'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useAppStore } from '../../state/useAppStore'
import { paneWriters } from '../../state/paneWriters'
import { firstLeaf, allLeaves } from '../../state/layout'
import { launchCommand } from './launcherCommands'
import { confirmCloseLeaves } from './closeGuard'
import claudeIcon from '../../assets/claudecode.svg'

/** Send a command into the focused terminal pane of the active tab. */
function runInFocusedPane(cmd: string): void {
  const { tabs, activeId } = useWorkspaceStore.getState()
  const tab = tabs.find((t) => t.id === activeId)
  if (tab) paneWriters.write(tab.focusedLeafId, cmd)
}

const GRID_PRESETS: { label: string; rows: number; cols: number }[] = [
  { label: '1', rows: 1, cols: 1 },
  { label: '2 × 1', rows: 1, cols: 2 },
  { label: '2 × 2', rows: 2, cols: 2 },
  { label: '3 × 2', rows: 2, cols: 3 },
  { label: '3 × 3', rows: 3, cols: 3 }
]

export function TabStrip() {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const activity = useWorkspaceStore((s) => s.activity)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const close = useWorkspaceStore((s) => s.close)
  const open = useWorkspaceStore((s) => s.open)
  const rename = useWorkspaceStore((s) => s.rename)
  const reorder = useWorkspaceStore((s) => s.reorder)
  const makeGrid = useWorkspaceStore((s) => s.makeGrid)
  const projectPath = useAppStore((s) => s.project?.path)
  const claudeButtons = useAppStore((s) => s.settings?.terminal.claudeButtons) ?? true

  const [editing, setEditing] = useState<string | null>(null)
  const [gridOpen, setGridOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)
  const launcherRef = useRef<HTMLDivElement | null>(null)

  // Close the launcher menu on any click outside it.
  useEffect(() => {
    if (!launcherOpen) return
    const onDown = (e: MouseEvent): void => {
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [launcherOpen])

  return (
    <div className="tabstrip">
      <div className="tabstrip__tabs">
        {tabs.map((t, i) => (
          <div
            key={t.id}
            className={`tab${t.id === activeId ? ' tab--active' : ''}`}
            draggable={editing !== t.id}
            title={firstLeaf(t.layout).cwd}
            onMouseDown={() => setActive(t.id)}
            onDoubleClick={() => setEditing(t.id)}
            onDragStart={() => {
              dragFrom.current = i
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragFrom.current !== null && dragFrom.current !== i) reorder(dragFrom.current, i)
              dragFrom.current = null
            }}
          >
            {activity[t.id] && t.id !== activeId && <span className="tab__dot" />}
            {editing === t.id ? (
              <input
                className="tab__input"
                defaultValue={t.title}
                autoFocus
                onFocus={(e) => e.target.select()}
                onMouseDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  rename(t.id, e.target.value)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  else if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <span className="tab__title">{t.title}</span>
            )}
            {tabs.length > 1 && (
              <button
                className="tab__close"
                title="Close terminal"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const ids = allLeaves(t.layout).map((l) => l.id)
                  void confirmCloseLeaves(ids).then((proceed) => {
                    if (proceed) close(t.id)
                  })
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        className="tabstrip__add"
        data-tip="New terminal (⌘T)"
        aria-label="New terminal"
        onClick={() => projectPath && open(projectPath)}
      >
        <Plus size={14} />
      </button>
      <div className="tabstrip__grid">
        <button
          className="tabstrip__add"
          data-tip="Split into a grid"
          aria-label="Split into a grid"
          onClick={() => setGridOpen((o) => !o)}
        >
          <LayoutGrid size={14} />
        </button>
        {gridOpen && (
          <div className="grid-menu" onMouseLeave={() => setGridOpen(false)}>
            <div className="grid-menu__label">Split this tab into…</div>
            {GRID_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  makeGrid(p.rows, p.cols)
                  setGridOpen(false)
                }}
              >
                {p.label}
                {p.rows * p.cols > 1 ? ` · ${p.rows * p.cols} terminals` : ' · single'}
              </button>
            ))}
          </div>
        )}
      </div>
      {claudeButtons && (
        <div className="tabstrip__claude" ref={launcherRef}>
          <div className="claude-split">
            <button
              className="claude-launch claude-launch--primary"
              data-tip="Run claude in this terminal"
              aria-label="Run claude"
              onClick={() => runInFocusedPane(launchCommand('new'))}
            >
              <img className="claude-launch__icon" src={claudeIcon} alt="" draggable={false} />
              <span>Claude</span>
            </button>
            <button
              className="claude-launch claude-launch--caret"
              data-tip="Resume or continue a session"
              aria-label="Claude session options"
              aria-haspopup="menu"
              aria-expanded={launcherOpen}
              onClick={() => setLauncherOpen((o) => !o)}
            >
              <ChevronDown size={13} />
            </button>
          </div>
          {launcherOpen && (
            <div className="launcher-menu" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  runInFocusedPane(launchCommand('new'))
                  setLauncherOpen(false)
                }}
              >
                <Plus size={13} /> New session
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  runInFocusedPane(launchCommand('resume'))
                  setLauncherOpen(false)
                }}
              >
                <RotateCcw size={13} /> Resume session
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  runInFocusedPane(launchCommand('continue'))
                  setLauncherOpen(false)
                }}
              >
                <ChevronsRight size={13} /> Continue last
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
