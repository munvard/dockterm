import { useEffect, useMemo, useRef, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronsDownUp, Regex, SquareTerminal, WholeWord, X } from 'lucide-react'
import type { ContentFileResult } from '@shared/search/types'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useSearchStore } from '../../state/useSearchStore'
import { useWindowedList } from '../../hooks/useWindowedList'
import { iconFor } from '../files/fileIcons'
import { baseName, parentOf, sendPathsToTerminal } from '../files/pathActions'
import { rangeRuns } from './highlight'

const ROW_H = 22

type Row =
  | { kind: 'file'; file: ContentFileResult; collapsed: boolean }
  | { kind: 'match'; file: ContentFileResult; at: number }

export function buildRows(files: ContentFileResult[], collapsed: ReadonlySet<string>): Row[] {
  const rows: Row[] = []
  for (const file of files) {
    const isCollapsed = collapsed.has(file.relPath)
    rows.push({ kind: 'file', file, collapsed: isCollapsed })
    if (!isCollapsed) for (let at = 0; at < file.matches.length; at++) rows.push({ kind: 'match', file, at })
  }
  return rows
}

function seconds(ms: number): string {
  return ms < 950 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`
}

export function FindInFilesPanel() {
  const find = useSearchStore((s) => s.find)
  const run = useSearchStore((s) => s.run)
  const setFind = useSearchStore((s) => s.setFind)
  const focusTick = useSearchStore((s) => s.findFocusTick)
  const includeIgnored = useAppStore((s) => s.settings?.files.searchIgnored ?? false)
  const updatePreferences = useAppStore((s) => s.updatePreferences)
  const [showGlobs, setShowGlobs] = useState(() => find.include !== '' || find.exclude !== '')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = useRef(true)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusTick])

  // Re-run a moment after the query or an option changes (the first mount only shows what is there).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void useSearchStore.getState().startFind(), find.query ? 260 : 0)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [find.query, find.caseSensitive, find.wholeWord, find.regex, find.include, find.exclude, includeIgnored])

  const rows = useMemo(() => buildRows(run.files, collapsed), [run.files, collapsed])
  const { range } = useWindowedList(listRef, rows.length, ROW_H, 10)

  const openMatch = (rel: string, line?: number): void => {
    void useEditorStore.getState().open(rel, baseName(rel), line)
  }

  const done = run.done
  const progress = run.total && run.total > 0 ? Math.min(1, run.scanned / run.total) : 0
  const moreLines = done ? Math.max(0, done.totalLines - done.storedLines) : 0
  const noMatch = !!done && !run.error && !done.canceled && run.files.length === 0

  const toggleCollapse = (rel: string): void =>
    setCollapsed((c) => {
      const next = new Set(c)
      if (!next.delete(rel)) next.add(rel)
      return next
    })

  return (
    <div className="panel fif">
      <div className="panel__head">
        <span className="panel__title">Find in Files</span>
        <div className="panel__actions">
          <button
            className="iconbtn iconbtn--sm"
            title="Collapse all results"
            disabled={run.files.length === 0}
            onClick={() => setCollapsed(new Set(run.files.map((f) => f.relPath)))}
          >
            <ChevronsDownUp size={13} />
          </button>
          <button
            className="iconbtn iconbtn--sm"
            title="Send the paths of these files to the terminal"
            disabled={run.files.length === 0}
            onClick={() => sendPathsToTerminal(run.files.map((f) => f.relPath))}
          >
            <SquareTerminal size={13} />
          </button>
          <button
            className="iconbtn iconbtn--sm"
            title="Clear"
            disabled={!find.query && run.files.length === 0}
            onClick={() => {
              setFind({ query: '' })
              useSearchStore.getState().clearFind()
              inputRef.current?.focus()
            }}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="fif__form">
        <div className="fif__box">
          <input
            ref={inputRef}
            className="fif__input"
            value={find.query}
            spellCheck={false}
            autoCorrect="off"
            placeholder="Search text in all files"
            onChange={(e) => setFind({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (timer.current) clearTimeout(timer.current)
                void useSearchStore.getState().startFind()
              } else if (e.key === 'Escape' && run.running) {
                useSearchStore.getState().cancelFind()
              }
            }}
          />
          <button
            className={`fif__tog${find.caseSensitive ? ' fif__tog--on' : ''}`}
            aria-pressed={find.caseSensitive}
            title="Match case"
            onClick={() => setFind({ caseSensitive: !find.caseSensitive })}
          >
            <CaseSensitive size={14} />
          </button>
          <button
            className={`fif__tog${find.wholeWord ? ' fif__tog--on' : ''}`}
            aria-pressed={find.wholeWord}
            title="Match whole word"
            onClick={() => setFind({ wholeWord: !find.wholeWord })}
          >
            <WholeWord size={14} />
          </button>
          <button
            className={`fif__tog${find.regex ? ' fif__tog--on' : ''}`}
            aria-pressed={find.regex}
            title="Regular expression"
            onClick={() => setFind({ regex: !find.regex })}
          >
            <Regex size={14} />
          </button>
        </div>
        <div className="fif__opts">
          <button className="fif__link" onClick={() => setShowGlobs((v) => !v)} aria-expanded={showGlobs}>
            {showGlobs ? <ChevronDown size={12} /> : <ChevronRight size={12} />} files to include or exclude
          </button>
          <button
            className={`fif__tog fif__tog--text${includeIgnored ? ' fif__tog--on' : ''}`}
            aria-pressed={includeIgnored}
            title="Also search ignored folders: node_modules, build output, .git"
            onClick={() => void updatePreferences({ files: { searchIgnored: !includeIgnored } })}
          >
            Include ignored
          </button>
        </div>
        {showGlobs && (
          <div className="fif__globs">
            <input
              className="fif__input fif__input--sm"
              value={find.include}
              spellCheck={false}
              placeholder="Include, e.g. src/**, *.ts"
              onChange={(e) => setFind({ include: e.target.value })}
            />
            <input
              className="fif__input fif__input--sm"
              value={find.exclude}
              spellCheck={false}
              placeholder="Exclude, e.g. **/*.test.ts"
              onChange={(e) => setFind({ exclude: e.target.value })}
            />
          </div>
        )}
      </div>

      <div className="fif__status" role="status">
        {run.running ? (
          <>
            <span className="fif__statustext">
              {run.total === null
                ? 'Preparing the file list…'
                : `Searching ${run.scanned.toLocaleString()} of ${run.total.toLocaleString()} files`}
            </span>
            <button className="fif__cancel" onClick={() => useSearchStore.getState().cancelFind()}>
              Cancel
            </button>
            <span className="fif__bar" aria-hidden>
              <span className="fif__barfill" style={{ transform: `scaleX(${progress})` }} />
            </span>
          </>
        ) : run.error ? (
          <span className="fif__statustext fif__statustext--err">{run.error}</span>
        ) : done ? (
          <span className="fif__statustext">
            {done.canceled ? 'Stopped. ' : ''}
            {done.totalLines.toLocaleString()} result{done.totalLines === 1 ? '' : 's'} in{' '}
            {done.filesWithMatches.toLocaleString()} file{done.filesWithMatches === 1 ? '' : 's'}
            {` · ${done.scanned.toLocaleString()} searched in ${seconds(run.finishedAt - run.startedAt)}`}
            {done.skippedLarge + done.skippedBinary > 0
              ? ` · ${(done.skippedLarge + done.skippedBinary).toLocaleString()} binary or large files skipped`
              : ''}
          </span>
        ) : (
          <span className="fif__statustext fif__statustext--dim">Type to search. Enter runs it now.</span>
        )}
      </div>

      <div className="fif__list" ref={listRef}>
        {noMatch && <div className="fif__empty">No results{includeIgnored ? '' : '. Include ignored searches node_modules and build folders.'}</div>}
        <div style={{ height: range.height, position: 'relative' }}>
          {rows.slice(range.start, range.end).map((row, i) => {
            const top = (range.start + i) * ROW_H
            if (row.kind === 'file') {
              const name = baseName(row.file.relPath)
              const { Icon, tone } = iconFor(name, false)
              return (
                <div
                  key={`f:${row.file.relPath}`}
                  className="fif__row fif__row--file"
                  style={{ top, height: ROW_H }}
                  onClick={() => toggleCollapse(row.file.relPath)}
                  title={row.file.relPath}
                >
                  {row.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <Icon size={13} className={`ficon ficon--${tone}`} />
                  <span className="fif__fname">{name}</span>
                  <span className="fif__fdir">{parentOf(row.file.relPath)}</span>
                  <span className="fif__count">{row.file.totalLines}</span>
                </div>
              )
            }
            const m = row.file.matches[row.at]
            const lead = m.text.length - m.text.trimStart().length
            const text = m.text.slice(lead).trimEnd()
            const ranges = m.ranges.map(([s, e]) => [Math.max(0, s - lead), Math.max(0, e - lead)] as const)
            return (
              <div
                key={`m:${row.file.relPath}:${m.line}:${row.at}`}
                className="fif__row fif__row--match"
                style={{ top, height: ROW_H }}
                onClick={() => openMatch(row.file.relPath, m.line)}
                title={`${row.file.relPath}:${m.line}`}
              >
                <span className="fif__line">{m.line}</span>
                <span className="fif__text">{rangeRuns(text, ranges)}</span>
              </div>
            )
          })}
        </div>
        {moreLines > 0 && (
          <div className="fif__more">
            {moreLines.toLocaleString()} more result{moreLines === 1 ? '' : 's'} not shown. Narrow the search with a more
            specific text or the include box.
          </div>
        )}
      </div>
    </div>
  )
}
