import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileSearch, Loader, Terminal as TerminalIcon } from 'lucide-react'
import type { QuickHit } from '@shared/search/pathIndex'
import type { IndexStatus } from '@shared/search/types'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useGitStore } from '../../state/useGitStore'
import { readRecent, useSearchStore } from '../../state/useSearchStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { refocusIfTerminal } from '../terminal/PaneTree'
import { iconFor } from '../files/fileIcons'
import { buildGitBadges } from '../files/gitBadges'
import { baseName, parentOf, sendPathsToTerminal } from '../files/pathActions'
import { highlightRuns } from './highlight'
import { k } from '../../hooks/keys'

const OWNER = 1
const LIMIT = 60

export function indexNote(s: IndexStatus | null, includeIgnored: boolean): string {
  if (!s) return 'Starting the file index…'
  if (s.state === 'disabled') return s.reason ?? 'Search is off for this folder'
  const n = s.files.toLocaleString()
  if (s.state === 'indexing') {
    const waitingIgnored = s.phase === 'ignored' && includeIgnored
    return waitingIgnored ? `Indexing ignored folders… ${n} files so far` : `Indexing… ${n} files so far`
  }
  if (s.truncated) return `${n} files indexed (the project is larger than the index limit)`
  return `${n} files indexed`
}

export function QuickOpen() {
  const open = useSearchStore((s) => s.quickOpen)
  return open ? <QuickOpenPanel /> : null
}

function QuickOpenPanel() {
  const close = useSearchStore((s) => s.closeQuick)
  const index = useSearchStore((s) => s.index)
  const root = useAppStore((s) => s.activeRoot)
  const includeIgnored = useAppStore((s) => s.settings?.files.searchIgnored ?? false)
  const updatePreferences = useAppStore((s) => s.updatePreferences)
  const status = useGitStore((s) => s.status)
  const badges = useMemo(() => buildGitBadges(status), [status])
  const recent = useMemo(() => readRecent(root), [root])

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<QuickHit[]>([])
  const [total, setTotal] = useState(0)
  const [totalApprox, setTotalApprox] = useState(false)
  const [line, setLine] = useState<number | null>(null)
  const [sel, setSel] = useState(0)
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const indexKey = index ? `${index.state}:${index.phase}:${Math.floor(index.files / 500)}` : 'none'

  useEffect(() => {
    const mine = ++seq.current
    void window.dockterm
      .invoke('search:files', { query, includeIgnored, kinds: 'files', limit: LIMIT, recent, owner: OWNER })
      .then((r) => {
        if (mine !== seq.current || !r.ok || r.value.stale) return
        setHits(r.value.results.hits)
        setTotal(r.value.results.total)
        setTotalApprox(r.value.results.totalApprox === true)
        setLine(r.value.results.line)
        setSel((s) => (query === '' ? 0 : Math.min(s, Math.max(0, r.value.results.hits.length - 1))))
      })
  }, [query, includeIgnored, recent, indexKey])

  useEffect(() => {
    setSel(0)
  }, [query, includeIgnored])

  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, hits])

  const finish = useCallback(() => {
    close()
    const { tabs, activeId } = useWorkspaceStore.getState()
    const leaf = tabs.find((t) => t.id === activeId)?.focusedLeafId
    if (leaf) refocusIfTerminal(leaf)
  }, [close])

  const openHit = (hit: QuickHit): void => {
    useSearchStore.getState().pushRecent(hit.relPath)
    close()
    void useEditorStore.getState().open(hit.relPath, baseName(hit.relPath), line ?? undefined)
  }

  const sendHit = (hit: QuickHit): void => {
    if (sendPathsToTerminal([hit.relPath])) finish()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      finish()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(hits.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'PageDown') {
      e.preventDefault()
      setSel((s) => Math.min(hits.length - 1, s + 8))
    } else if (e.key === 'PageUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 8))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const hit = hits[sel]
      if (!hit) return
      if (e.metaKey || e.ctrlKey) sendHit(hit)
      else openHit(hit)
    }
  }

  return (
    <div className="qo" onMouseDown={(e) => e.target === e.currentTarget && finish()}>
      <div className="qo__panel" role="dialog" aria-label="Quick open" onKeyDown={onKeyDown}>
        <div className="qo__head">
          <FileSearch size={15} className="qo__icon" />
          <input
            ref={inputRef}
            autoFocus
            className="qo__input"
            value={query}
            spellCheck={false}
            autoCorrect="off"
            placeholder="Go to file…  (name, folder/name, *.ext, name:line)"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`qo__chip${includeIgnored ? ' qo__chip--on' : ''}`}
            aria-pressed={includeIgnored}
            title="Also search ignored folders: node_modules, build output, .git"
            onClick={() => void updatePreferences({ files: { searchIgnored: !includeIgnored } })}
          >
            Include ignored
          </button>
        </div>
        <div className="qo__list" ref={listRef} role="listbox">
          {hits.length === 0 && (
            <div className="qo__empty">
              {index && index.state === 'indexing' ? (
                <>
                  <Loader size={13} className="qo__spin" /> {indexNote(index, includeIgnored)}
                </>
              ) : query ? (
                includeIgnored ? (
                  'No file matches'
                ) : (
                  'No file matches. Try Include ignored for node_modules and build folders.'
                )
              ) : (
                'No files'
              )}
            </div>
          )}
          {hits.map((hit, i) => {
            const name = baseName(hit.relPath)
            const dir = parentOf(hit.relPath)
            const nameStart = hit.relPath.length - name.length
            const { Icon, tone } = iconFor(name, hit.isDir)
            const badge = badges.get(hit.relPath)
            return (
              <div
                key={hit.relPath}
                role="option"
                aria-selected={i === sel}
                className={`qo__row${i === sel ? ' qo__row--sel' : ''}${hit.ignored ? ' qo__row--ignored' : ''}`}
                onMouseMove={() => i !== sel && setSel(i)}
                onClick={() => openHit(hit)}
              >
                <Icon size={14} className={`ficon ficon--${tone}`} />
                <span className="qo__name">{highlightRuns(name, nameStart, hit.positions)}</span>
                {dir && <span className="qo__dir">{highlightRuns(dir, 0, hit.positions)}</span>}
                {hit.ignored && <span className="qo__tag">ignored</span>}
                {badge && <span className={`git-badge git-badge--${badge.cls}`}>{badge.letter}</span>}
                {i === sel && (
                  <button
                    type="button"
                    className="qo__send"
                    title={`Paste the path into the terminal (${k('⌘', 'Ctrl')}+Enter)`}
                    onClick={(e) => {
                      e.stopPropagation()
                      sendHit(hit)
                    }}
                  >
                    <TerminalIcon size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="qo__foot">
          <span className="qo__note">
            {indexNote(index, includeIgnored)}
            {total > hits.length ? ` · ${total.toLocaleString()}${totalApprox ? '+' : ''} matches, showing ${hits.length}` : ''}
            {line ? ` · line ${line}` : ''}
          </span>
          <span className="qo__keys">
            <kbd>
              <CornerDownLeft size={10} />
            </kbd>{' '}
            open <kbd>{k('⌘', 'Ctrl')}+↵</kbd> paste path
          </span>
        </div>
      </div>
    </div>
  )
}
