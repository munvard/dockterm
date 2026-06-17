import { GitBranch, FolderOpen, SquareTerminal, ArrowUp, ArrowDown } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useGitStore } from '../../state/useGitStore'
import { PANELS } from './panels'

export function TopBar() {
  const project = useAppStore((s) => s.project)
  const openDialog = useAppStore((s) => s.openProjectDialog)
  const openPanel = useAppStore((s) => s.openPanel)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const miniTermOpen = useAppStore((s) => s.miniTermOpen)
  const toggleMini = useAppStore((s) => s.toggleMiniTerm)
  const status = useGitStore((s) => s.status)

  const dirty = status
    ? status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length
    : 0
  const upstream = status?.upstream

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className="topbar__project"
          onClick={() => void openDialog()}
          title="Open another project"
        >
          <FolderOpen size={13} />
          <span>{project?.name ?? 'DockTerm'}</span>
        </button>
        {project?.branch && (
          <span className="topbar__branch">
            <GitBranch size={12} />
            {project.branch}
          </span>
        )}
        {upstream && (upstream.ahead > 0 || upstream.behind > 0) && (
          <span className="topbar__sync">
            {upstream.behind > 0 && (
              <span>
                <ArrowDown size={11} />
                {upstream.behind}
              </span>
            )}
            {upstream.ahead > 0 && (
              <span>
                <ArrowUp size={11} />
                {upstream.ahead}
              </span>
            )}
          </span>
        )}
        {status && status.repoState !== 'not-repo' && (
          <span className={`chip ${dirty > 0 ? 'chip--dirty' : 'chip--clean'}`}>
            {dirty > 0 ? `${dirty} changed` : 'Clean'}
          </span>
        )}
      </div>
      <div className="topbar__right">
        {PANELS.map((panel) => {
          const Icon = panel.icon
          return (
            <button
              key={panel.id}
              className={`iconbtn${openPanel === panel.id ? ' iconbtn--active' : ''}`}
              title={panel.label}
              aria-label={panel.label}
              onClick={() => togglePanel(panel.id)}
            >
              <Icon size={15} />
            </button>
          )
        })}
        <span className="topbar__divider" />
        <button
          className={`iconbtn${miniTermOpen ? ' iconbtn--active' : ''}`}
          title="Toggle mini terminal"
          aria-label="Toggle mini terminal"
          onClick={toggleMini}
        >
          <SquareTerminal size={15} />
        </button>
      </div>
    </header>
  )
}
