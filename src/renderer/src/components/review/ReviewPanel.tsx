import { useEffect } from 'react'
import { RefreshCw, GitCommitHorizontal, Plus, AlertTriangle, Check, Bookmark } from 'lucide-react'
import { useReviewStore } from '../../state/useReviewStore'
import { useGitStore } from '../../state/useGitStore'
import { useAppStore } from '../../state/useAppStore'
import { useDialogStore } from '../../state/useDialogStore'
import type { ReviewBase, GitFileStatus } from '@shared/types'

const BASES: { id: ReviewBase; label: string }[] = [
  { id: 'working', label: 'Last commit' },
  { id: 'session', label: 'Session' },
  { id: 'checkpoint', label: 'Checkpoint' }
]

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

// The root the open diff belongs to. Module-level so it survives the panel
// unmounting: reopening the panel on the same project must keep the open diff.
let diffRoot: string | null | undefined

export function ReviewPanel() {
  const review = useReviewStore()
  const stage = useGitStore((s) => s.stage)
  const setOpenPanel = useAppStore((s) => s.setOpenPanel)
  const beginner = useAppStore((s) => s.settings?.git.beginnerMode ?? true)
  const activeRoot = useAppStore((s) => s.activeRoot)

  // Re-read whenever the focused pane's project changes — otherwise this kept
  // showing the first-opened project's diff, and an open diff pane could point
  // at a file from a project that's no longer focused.
  useEffect(() => {
    if (diffRoot !== undefined && diffRoot !== activeRoot) useReviewStore.getState().closeDiff()
    diffRoot = activeRoot
    void review.refresh()
    void review.refreshCheckpoint()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.dockterm.on('fs:watch', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void useReviewStore.getState().refresh(), 500)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoot])

  const files = review.files
  const totalIns = files.reduce((a, f) => a + f.insertions, 0)
  const totalDel = files.reduce((a, f) => a + f.deletions, 0)
  const sinceLabel =
    review.base === 'checkpoint'
      ? 'your checkpoint'
      : review.base === 'session'
        ? 'this session started'
        : 'your last commit'

  const cp = review.checkpoint?.checkpoint
  const cpStale = review.checkpoint?.stale

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Review</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={() => void review.refresh()}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      <div className="review-bases">
        {BASES.map((b) => (
          <button
            key={b.id}
            className={`review-base${review.base === b.id ? ' is-active' : ''}`}
            onClick={() => void review.setBase(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="review-checkpoint">
        {cp ? (
          cpStale ? (
            <span className="review-cp-stale">
              <AlertTriangle size={12} /> Checkpoint no longer exists
            </span>
          ) : (
            <span className="review-cp">
              <Bookmark size={12} /> {cp.label} · {cp.hash.slice(0, 7)}
            </span>
          )
        ) : (
          <span className="review-cp-none">No checkpoint set</span>
        )}
        <button
          className="git-linkbtn"
          onClick={async () => {
            const label = await useDialogStore.getState().prompt({
              title: 'Create checkpoint',
              label: 'Label (optional)',
              placeholder: 'before refactor',
              confirmLabel: 'Create',
              allowEmpty: true
            })
            if (label !== null) void review.createCheckpoint(label)
          }}
        >
          {cp ? 'Update' : 'Create checkpoint'}
        </button>
      </div>

      {beginner && <div className="review-hint">Files changed since {sinceLabel}.</div>}

      <div className="panel__body">
        {files.length === 0 ? (
          <div className="git-clean">
            <Check size={14} /> No changes to review.
          </div>
        ) : (
          <>
            <div className="review-summary">
              {files.length} file{files.length > 1 ? 's' : ''} ·{' '}
              <span className="review-ins">+{totalIns}</span> <span className="review-del">-{totalDel}</span>
            </div>
            {files.map((f) => {
              const badge = BADGE[f.status]
              return (
                <div className="git-row" key={f.relPath}>
                  <span className={`git-badge git-badge--${badge.cls}`}>{badge.letter}</span>
                  <span
                    className="git-row__path"
                    title={f.relPath}
                    onClick={() => void review.openDiff(f.relPath)}
                  >
                    {f.relPath}
                  </span>
                  <span className="review-stat">
                    <span className="review-ins">+{f.insertions}</span>{' '}
                    <span className="review-del">-{f.deletions}</span>
                  </span>
                  <div className="git-row__actions">
                    <button className="iconbtn iconbtn--sm" title="Stage" onClick={() => void stage([f.relPath])}>
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {files.length > 0 && (
        <div className="git-commit">
          <button className="btn btn--ghost btn--sm" onClick={() => void useGitStore.getState().stageAll()}>
            Stage all
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setOpenPanel('git')}>
            <GitCommitHorizontal size={14} /> Commit in Source Control
          </button>
        </div>
      )}
    </div>
  )
}
