import { useState, type ReactNode } from 'react'
import {
  RefreshCw,
  GitBranch,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  RotateCcw,
  GitCommitHorizontal,
  ChevronDown,
  Trash2,
  Check,
  AlertTriangle,
  GitBranchPlus
} from 'lucide-react'
import { useGitStore } from '../../state/useGitStore'
import { useAppStore } from '../../state/useAppStore'
import { useReviewStore } from '../../state/useReviewStore'
import { useDialogStore } from '../../state/useDialogStore'
import type { GitFileEntry, GitFileStatus } from '@shared/types'

const BADGE: Record<GitFileStatus, { letter: string; cls: string }> = {
  modified: { letter: 'M', cls: 'mod' },
  added: { letter: 'A', cls: 'add' },
  deleted: { letter: 'D', cls: 'del' },
  renamed: { letter: 'R', cls: 'ren' },
  copied: { letter: 'C', cls: 'add' },
  typechange: { letter: 'T', cls: 'mod' },
  untracked: { letter: 'U', cls: 'unt' },
  conflicted: { letter: '!', cls: 'con' }
}

function Section({
  title,
  hint,
  action,
  children
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="git-section">
      <div className="git-section__head">
        <span className="git-section__title">{title}</span>
        {action}
      </div>
      {hint && <div className="git-section__hint">{hint}</div>}
      <div>{children}</div>
    </div>
  )
}

export function GitPanel() {
  const store = useGitStore()
  const status = store.status
  const beginner = useAppStore((s) => s.settings?.git.beginnerMode ?? true)
  const initGit = useAppStore((s) => s.initGitRepo)
  const activeRoot = useAppStore((s) => s.activeRoot)
  const project = useAppStore((s) => s.project)
  const message = store.draftMessage
  const setMessage = store.setDraftMessage
  const [branchMenu, setBranchMenu] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const header = (
    <div className="panel__head">
      <span className="panel__title">Source Control</span>
      <div className="panel__actions">
        <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void store.refresh()}>
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  )

  const handleInitGit = async () => {
    const target = activeRoot ?? project?.path ?? ''
    const confirmed = await useDialogStore.getState().confirm({
      title: 'Initialize Git repository',
      message: 'Create a new Git repository in this folder?',
      detail: target,
      confirmLabel: 'Initialize',
      command: 'git init'
    })
    if (!confirmed) return
    await initGit()
    await store.refresh()
  }

  // No status yet: either still loading, or the last refresh failed outright
  // (never conflate the two with "not a repo" — that was the actual bug behind
  // "Git not initialized" showing for a real repository).
  if (!status) {
    return (
      <div className="panel">
        {header}
        <div className="panel__body git-empty">
          {store.error ? (
            <>
              <p className="git-empty__error">
                <AlertTriangle size={13} /> Couldn&apos;t read Git status.
              </p>
              <p className="git-section__hint">{store.error}</p>
              <button className="btn btn--ghost btn--sm" onClick={() => void store.refresh()}>
                <RefreshCw size={13} /> Retry
              </button>
            </>
          ) : (
            <p>Loading…</p>
          )}
        </div>
      </div>
    )
  }

  if (status.repoState === 'not-repo') {
    return (
      <div className="panel">
        {header}
        <div className="panel__body git-empty">
          <p>This folder isn&apos;t a Git repository.</p>
          <button className="btn btn--ghost btn--sm" onClick={() => void handleInitGit()}>
            <GitBranchPlus size={13} /> Initialize Git
          </button>
        </div>
      </div>
    )
  }

  const row = (file: GitFileEntry, actions: ReactNode) => {
    const badge = BADGE[file.status]
    return (
      <div className="git-row" key={`${file.staged ? 's' : 'u'}-${file.path}`}>
        <span className={`git-badge git-badge--${badge.cls}`}>{badge.letter}</span>
        <span
          className="git-row__path"
          title={file.path}
          onClick={() => void useReviewStore.getState().openDiff(file.path, 'working')}
        >
          {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        </span>
        <div className="git-row__actions">{actions}</div>
      </div>
    )
  }

  const canCommit = status.staged.length > 0 && message.trim().length > 0
  const doCommit = async () => {
    if (!canCommit) return
    // useGitStore.commit() clears the draft itself on success.
    await store.commit(message.trim())
  }

  return (
    <div className="panel">
      {header}

      <div className="git-branchbar">
        <button
          className="git-branchbtn"
          onClick={() => {
            setBranchMenu((v) => !v)
            void store.refreshBranches()
          }}
        >
          <GitBranch size={13} />
          <span>{status.branch ?? 'HEAD'}</span>
          <ChevronDown size={12} />
        </button>
        {status.upstream && (
          <span className="git-sync">
            {status.upstream.behind > 0 && (
              <span>
                <ArrowDown size={11} />
                {status.upstream.behind}
              </span>
            )}
            {status.upstream.ahead > 0 && (
              <span>
                <ArrowUp size={11} />
                {status.upstream.ahead}
              </span>
            )}
          </span>
        )}
        <div className="git-branchbar__spacer" />
        <button className="iconbtn iconbtn--sm" title="Pull" disabled={store.busy} onClick={() => void store.pull()}>
          <ArrowDown size={14} />
        </button>
        <button
          className="iconbtn iconbtn--sm"
          title={status.upstream ? 'Push' : 'Publish branch'}
          disabled={store.busy}
          onClick={() => void store.push()}
        >
          <ArrowUp size={14} />
        </button>
        {branchMenu && store.branches && (
          <div className="git-branchmenu" onMouseLeave={() => setBranchMenu(false)}>
            {store.branches.all.map((b) => (
              <div key={b} className={`git-branchmenu__item${b === status.branch ? ' is-current' : ''}`}>
                <button
                  className="git-branchmenu__switch"
                  onClick={() => {
                    setBranchMenu(false)
                    if (b !== status.branch) void store.switchBranch(b)
                  }}
                >
                  {b === status.branch ? <Check size={12} /> : <span className="git-branchmenu__gap" />}
                  {b}
                </button>
                {b !== status.branch && (
                  <button
                    className="git-branchmenu__del"
                    title="Delete branch"
                    onClick={() => void store.deleteBranch(b)}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            <button
              className="git-branchmenu__new"
              onClick={async () => {
                setBranchMenu(false)
                const name = await useDialogStore.getState().prompt({
                  title: 'New branch',
                  label: 'Branch name',
                  confirmLabel: 'Create & switch'
                })
                if (name) void store.createBranch(name)
              }}
            >
              <GitBranchPlus size={12} /> New branch…
            </button>
          </div>
        )}
      </div>

      {store.error && (
        <div className="git-note git-note--warn">
          <AlertTriangle size={12} /> Showing the last known status — refresh failed: {store.error}
        </div>
      )}
      {status.repoState === 'empty' && (
        <div className="git-note">No commits yet — make your first commit below.</div>
      )}
      {status.repoState === 'detached' && (
        <div className="git-note git-note--warn">
          <AlertTriangle size={12} /> Detached HEAD — check out a branch to commit normally.
        </div>
      )}
      {status.conflicted.length > 0 && (
        <div className="git-note git-note--warn">
          <AlertTriangle size={12} /> Merge conflicts — resolve them in the terminal, then stage.
        </div>
      )}

      <div className="panel__body git-body">
        {status.clean && status.repoState !== 'empty' && (
          <div className="git-clean">
            <Check size={14} /> Nothing to commit — working tree clean.
          </div>
        )}

        {status.conflicted.length > 0 && (
          <Section title="Conflicts">{status.conflicted.map((f) => row(f, null))}</Section>
        )}

        {status.staged.length > 0 && (
          <Section
            title="Staged"
            hint={beginner ? 'These changes will be saved in your next commit.' : undefined}
            action={
              <button className="git-linkbtn" onClick={() => void store.unstage(status.staged.map((f) => f.path))}>
                Unstage all
              </button>
            }
          >
            {status.staged.map((f) =>
              row(
                f,
                <button className="iconbtn iconbtn--sm" title="Unstage" onClick={() => void store.unstage([f.path])}>
                  <Minus size={13} />
                </button>
              )
            )}
          </Section>
        )}

        {status.unstaged.length > 0 && (
          <Section
            title="Changes"
            hint={beginner ? 'Stage the changes you want to include in your commit.' : undefined}
            action={
              <button className="git-linkbtn" onClick={() => void store.stage(status.unstaged.map((f) => f.path))}>
                Stage all
              </button>
            }
          >
            {status.unstaged.map((f) =>
              row(
                f,
                <>
                  <button
                    className="iconbtn iconbtn--sm"
                    title="Discard"
                    onClick={() => void store.discard([f.path], f.path)}
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button className="iconbtn iconbtn--sm" title="Stage" onClick={() => void store.stage([f.path])}>
                    <Plus size={13} />
                  </button>
                </>
              )
            )}
          </Section>
        )}

        {status.untracked.length > 0 && (
          <Section
            title="Untracked"
            hint={beginner ? "New files Git isn't tracking yet." : undefined}
            action={
              <button className="git-linkbtn" onClick={() => void store.stage(status.untracked.map((f) => f.path))}>
                Stage all
              </button>
            }
          >
            {status.untracked.map((f) =>
              row(
                f,
                <button className="iconbtn iconbtn--sm" title="Stage" onClick={() => void store.stage([f.path])}>
                  <Plus size={13} />
                </button>
              )
            )}
          </Section>
        )}
      </div>

      <div className="git-commit">
        <textarea
          className="git-commit__input"
          placeholder={status.staged.length ? 'Commit message' : 'Stage changes to commit'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void doCommit()
            }
          }}
          rows={2}
          spellCheck={false}
        />
        <button
          className="btn btn--primary btn--sm git-commit__btn"
          disabled={!canCommit || store.busy}
          onClick={() => void doCommit()}
        >
          <GitCommitHorizontal size={14} /> Commit{status.staged.length ? ` ${status.staged.length}` : ''}
        </button>
        {store.log.length > 0 && (
          <button className="git-linkbtn git-commit__log" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide' : 'Show'} git output
          </button>
        )}
        {showLog && <pre className="git-log">{store.log.slice(-10).join('\n')}</pre>}
      </div>
    </div>
  )
}
