import { FolderOpen, Clock, SquareTerminal } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'

export function EmptyState() {
  const openDialog = useAppStore((s) => s.openProjectDialog)
  const openProject = useAppStore((s) => s.openProject)
  const recent = useAppStore((s) => s.recent)
  const homeDir = useAppStore((s) => s.homeDir)
  const error = useAppStore((s) => s.error)

  return (
    <div className="empty">
      <div className="empty__card">
        <div className="empty__brand">DockTerm</div>
        <p className="empty__tag">Terminal-first workspace for Claude Code</p>
        <div className="empty__actions">
          <button className="btn btn--primary" onClick={() => void openDialog()}>
            <FolderOpen size={16} /> Open a project…
          </button>
          <button
            className="btn btn--ghost"
            title="Start a terminal in your home folder — cd anywhere or create a new project"
            disabled={!homeDir}
            onClick={() => homeDir && void openProject(homeDir)}
          >
            <SquareTerminal size={16} /> Open a terminal
          </button>
        </div>
        {error && <p className="empty__error">{error}</p>}
        {recent.length > 0 && (
          <div className="empty__recent">
            <div className="empty__recent-title">
              <Clock size={12} /> Recent
            </div>
            {recent.map((r) => (
              <button
                key={r.path}
                className="empty__recent-item"
                title={r.path}
                onClick={() => void openProject(r.path)}
              >
                <span className="empty__recent-name">{r.name}</span>
                <span className="empty__recent-path">{r.path}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
