import { GitBranch, FolderOpen, AppWindow, ArrowUp, ArrowDown } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useGitStore } from '../../state/useGitStore'
import { basenameOf } from '../../state/workspace'
import { TopBarTools } from './TopBarTools'

export function TopBar() {
  const project = useAppStore((s) => s.project)
  const activeRoot = useAppStore((s) => s.activeRoot)
  const openDialog = useAppStore((s) => s.openProjectDialog)
  const status = useGitStore((s) => s.status)

  // The name/branch follow the FOCUSED pane's resolved root and its live git
  // status, not the static first-opened project — a second window (or this one
  // after a `cd`/pane focus change) must show ITS own project, not a stale one.
  const name = (activeRoot ? basenameOf(activeRoot) : '') || project?.name || ''
  const displayPath = activeRoot ?? project?.path
  const branch = status?.branch ?? (activeRoot ? null : project?.branch ?? null)

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
        {name && (
          <span className="topbar__name" title={displayPath}>
            {name}
          </span>
        )}
        {branch && (
          <span className="topbar__branch">
            <GitBranch size={12} />
            {branch}
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
          <span
            className={`chip ${dirty > 0 ? 'chip--dirty' : 'chip--clean'}`}
            title={dirty > 0 ? `${dirty} changed` : 'Clean'}
          >
            {dirty > 0 ? (
              <>
                {dirty}
                <span className="chip__word"> changed</span>
              </>
            ) : (
              'Clean'
            )}
          </span>
        )}
      </div>
      <TopBarTools />
    </header>
  )
}
