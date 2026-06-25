import { lazy, Suspense, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, X, Check } from 'lucide-react'
import { useChangesStore } from '../../state/useChangesStore'
import { useAppStore } from '../../state/useAppStore'
import { useDragResize } from '../common/useDragResize'
import { ResizeHandles } from '../common/ResizeHandles'
import type { GitFileStatus } from '@shared/types'

const ChangesDiff = lazy(() => import('./ChangesDiff').then((m) => ({ default: m.ChangesDiff })))

const DEFAULT_SIZE = { w: 360, h: 560 }

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

/**
 * A floating, draggable card listing the files changed since the last commit
 * (what Claude is editing), updated live from `fs:watch`. Each row's triangle
 * expands an inline diff (diff-only by default, full file on toggle).
 *
 * Stays mounted (when enabled) so the list — and the hover preview's "changed"
 * badge — stay fresh even while the card is closed.
 */
export function ChangesOverlay(): React.ReactElement | null {
  const open = useChangesStore((s) => s.open)
  const files = useChangesStore((s) => s.files)
  const expanded = useChangesStore((s) => s.expanded)
  const full = useChangesStore((s) => s.full)
  const diffs = useChangesStore((s) => s.diffs)
  const pos = useChangesStore((s) => s.pos)
  const size = useChangesStore((s) => s.size)
  const autoReveal = useAppStore((s) => s.settings?.terminal.changesAutoReveal) ?? false

  const prevCount = useRef(0)
  // Don't auto-reveal from the initial startup scan (existing changes) — only when
  // changes actually grow during a working session. Arms shortly after mount.
  const armed = useRef(false)

  const { ref, style, onHeaderMouseDown, onResizeMouseDown } = useDragResize({
    pos,
    size,
    defaultSize: DEFAULT_SIZE,
    onMove: useChangesStore.getState().setPos,
    onResize: useChangesStore.getState().setSize
  })

  // Refresh now + on every file change (debounced) while mounted.
  useEffect(() => {
    void useChangesStore.getState().refresh()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.dockterm.on('fs:watch', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void useChangesStore.getState().refresh(), 500)
    })
    const armTimer = setTimeout(() => {
      armed.current = true
    }, 1500)
    return () => {
      off()
      if (timer) clearTimeout(timer)
      clearTimeout(armTimer)
    }
  }, [])

  // Auto-reveal only after arming (never on the startup scan), when changes grow,
  // and the user hasn't dismissed it this burst.
  useEffect(() => {
    const n = files.length
    if (armed.current && n > prevCount.current && autoReveal && !useChangesStore.getState().dismissed) {
      useChangesStore.getState().setOpen(true)
    }
    prevCount.current = n
  }, [files, autoReveal])

  const closeOverlay = (): void => useChangesStore.getState().setOpen(false)

  if (!open) return null

  const totalIns = files.reduce((a, f) => a + f.insertions, 0)
  const totalDel = files.reduce((a, f) => a + f.deletions, 0)

  return createPortal(
    <div ref={ref} className="changes-card" style={style}>
      <div className="changes-card__head" onMouseDown={onHeaderMouseDown}>
        <span className="changes-card__title">Changes</span>
        <span className="changes-card__summary">
          {files.length === 0 ? (
            'clean'
          ) : (
            <>
              <span className="review-ins">+{totalIns}</span> <span className="review-del">-{totalDel}</span>
            </>
          )}
        </span>
        <button className="iconbtn iconbtn--sm" title="Close" onClick={closeOverlay} aria-label="Close Changes">
          <X size={13} />
        </button>
      </div>
      <div className="changes-card__body">
        {files.length === 0 ? (
          <div className="changes-card__empty">
            <Check size={14} /> No changes yet.
          </div>
        ) : (
          files.map((f) => {
            const badge = BADGE[f.status]
            const isOpen = expanded === f.relPath
            const diff = diffs[f.relPath]
            return (
              <div className={`changes-row${isOpen ? ' is-open' : ''}`} key={f.relPath}>
                <button
                  className="changes-row__head"
                  onClick={() => void useChangesStore.getState().expand(f.relPath)}
                >
                  <ChevronRight size={13} className={`changes-row__tri${isOpen ? ' is-open' : ''}`} />
                  <span className={`git-badge git-badge--${badge.cls}`}>{badge.letter}</span>
                  <span className="changes-row__path" title={f.relPath}>
                    {f.relPath}
                  </span>
                  <span className="changes-row__stat">
                    <span className="review-ins">+{f.insertions}</span>{' '}
                    <span className="review-del">-{f.deletions}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="changes-row__diff">
                    <div className="changes-row__mode">
                      <button
                        className={!full ? 'is-active' : ''}
                        onClick={() => useChangesStore.getState().setFull(false)}
                      >
                        diff only
                      </button>
                      <button
                        className={full ? 'is-active' : ''}
                        onClick={() => useChangesStore.getState().setFull(true)}
                      >
                        full file
                      </button>
                    </div>
                    {diff ? (
                      <Suspense fallback={<div className="changes-row__loading">Loading…</div>}>
                        <ChangesDiff diff={diff} full={full} />
                      </Suspense>
                    ) : (
                      <div className="changes-row__loading">Loading…</div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      <ResizeHandles onResize={onResizeMouseDown} />
    </div>,
    document.body
  )
}
