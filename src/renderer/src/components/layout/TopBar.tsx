import { GitBranch, FolderOpen, AppWindow, SquareTerminal, ArrowUp, ArrowDown } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useGitStore } from '../../state/useGitStore'
import { UsagePill } from '../usage/UsagePill'
import { PANELS } from './panels'

export function TopBar() {
  const project = useAppStore((s) => s.project)
  const openDialog = useAppStore((s) => s.openProjectDialog)
  const openPanel = useAppStore((s) => s.openPanel)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const miniTermOpen = useAppStore((s) => s.miniTermOpen)
  const toggleMini = useAppStore((s) => s.toggleMiniTerm)
  const usageEnabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  const status = useGitStore((s) => s.status)

  // Hide the Usage dock icon when the user has turned Usage off.
  const panels = PANELS.filter((p) => p.id !== 'usage' || usageEnabled)

  const dirty = status
    ? status.staged.length + status.unstaged.length + status.untracked.length + status.conflicted.length
    : 0
  const upstream = status?.upstream

  return (
    <header className="topbar">
      <div className="topbar__left">
        <button
          className="iconbtn"
          onClick={() => void openDialog()}
          data-tip="Open project"
          aria-label="Open project"
        >
          <FolderOpen size={15} />
        </button>
        <button
          className="iconbtn"
          onClick={() => void window.dockterm.invoke('window:new', undefined)}
          data-tip="New window"
          aria-label="New window"
        >
          <AppWindow size={15} />
        </button>
        {project && (
          <span className="topbar__name" title={project.path}>
            {project.name}
          </span>
        )}
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
        <UsagePill />
        {panels.map((panel) => {
          const Icon = panel.icon
          return (
            <button
              key={panel.id}
              className={`iconbtn tip--end${openPanel === panel.id ? ' iconbtn--active' : ''}`}
              data-tip={panel.label}
              aria-label={panel.label}
              onClick={() => togglePanel(panel.id)}
            >
              <Icon size={15} />
            </button>
          )
        })}
        <span className="topbar__divider" />
        <button
          className={`iconbtn tip--end${miniTermOpen ? ' iconbtn--active' : ''}`}
          data-tip="Mini terminal"
          aria-label="Mini terminal"
          onClick={toggleMini}
        >
          <SquareTerminal size={15} />
        </button>
      </div>
    </header>
  )
}
