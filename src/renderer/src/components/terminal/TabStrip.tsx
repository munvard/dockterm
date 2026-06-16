import { useRef, useState } from 'react'
import { Plus, X, LayoutGrid, AppWindow } from 'lucide-react'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useAppStore } from '../../state/useAppStore'
import { firstLeaf } from '../../state/layout'

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

  const [editing, setEditing] = useState<string | null>(null)
  const [gridOpen, setGridOpen] = useState(false)
  const dragFrom = useRef<number | null>(null)

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
                  close(t.id)
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
        title="New terminal (⌘T)"
        onClick={() => projectPath && open(projectPath)}
      >
        <Plus size={14} />
      </button>
      <div className="tabstrip__grid">
        <button
          className="tabstrip__add"
          title="Arrange this tab as a grid"
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
      <button
        className="tabstrip__add"
        title="New window (⌘N)"
        onClick={() => void window.dockterm.invoke('window:new', undefined)}
      >
        <AppWindow size={14} />
      </button>
    </div>
  )
}
