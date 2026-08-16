import { useEffect, useState } from 'react'
import { SquareTerminal, ChevronDown, Loader2 } from 'lucide-react'
import { useReadingStore, normalizeReadingCwd } from '../../state/useReadingStore'
import { useMunuStore } from '../../state/useMunuStore'
import { paneWriters } from '../../state/paneWriters'
import { getPaneSample, paneVisibleText } from '../terminal/terminalPool'
import { paneClaudeActive } from '../terminal/paneClaudeActive'
import { ConversationList, useStickyScroll } from '../reading/ConversationList'
import { AskCard } from './AskCard'
import { Composer } from './Composer'

const POLL_MS = 700 // chat mode is the primary surface — faster than the side panel
const TAIL_MS = 300 // local buffer read, no IPC
const TAIL_LINES = 8

/**
 * Chat mode: the pane's whole Claude session as a rendered conversation with a
 * real input. The terminal is still mounted (hidden) right beside this, so the
 * pty, its size, and the buffer-derived status/ask parsing all keep working.
 */
export function PaneChat({
  cwd,
  leafId,
  onShowTerminal
}: {
  cwd: string | null
  leafId: string
  onShowTerminal: () => void
}): React.ReactElement {
  const conv = useReadingStore((s) => (cwd ? s.byCwd[normalizeReadingCwd(cwd)] : undefined))
  const load = useReadingStore((s) => s.load)
  const pane = useMunuStore((s) => s.panes[leafId])
  const state = pane?.state ?? 'idle'
  const ask = pane?.ask ?? null

  const [tail, setTail] = useState<string[]>([])
  const [workingSince, setWorkingSince] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [claudeHere, setClaudeHere] = useState(true)

  const messages = conv?.messages ?? []
  const { ref: bodyRef, atBottom, onScroll, jumpToLatest } = useStickyScroll(messages.length)

  // Poll this pane's conversation.
  useEffect(() => {
    if (!cwd) return
    let stop = false
    const refresh = (): void => {
      const sample = getPaneSample(leafId)
      void paneClaudeActive(leafId).then((active) => {
        if (stop) return
        setClaudeHere(active)
        void load(cwd, leafId, sample, active)
      })
    }
    refresh()
    const iv = setInterval(refresh, POLL_MS)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [cwd, leafId, load])

  // Live raw tail of the hidden terminal while Claude works.
  useEffect(() => {
    if (state !== 'working') {
      setTail([])
      setWorkingSince(null)
      return
    }
    setWorkingSince((cur) => cur ?? Date.now())
    const tick = (): void => {
      const lines = paneVisibleText(leafId)
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0)
      setTail(lines.slice(-TAIL_LINES))
    }
    tick()
    const iv = setInterval(tick, TAIL_MS)
    return () => clearInterval(iv)
  }, [state, leafId])

  // Elapsed counter for the working strip.
  useEffect(() => {
    if (workingSince === null) return
    const iv = setInterval(() => setElapsed(Math.round((Date.now() - workingSince) / 1000)), 500)
    return () => clearInterval(iv)
  }, [workingSince])

  const nothingHere = !claudeHere && messages.length === 0

  return (
    <div className="panechat">
      <div className="panechat__head">
        <span className="panechat__status">
          {state === 'working' && <Loader2 size={12} className="spin" />}
          {state === 'working' ? `working · ${elapsed}s` : state === 'asking' ? 'needs you' : 'ready'}
        </span>
        <button className="iconbtn iconbtn--sm" title="Show the terminal (⌘R)" onClick={onShowTerminal}>
          <SquareTerminal size={14} />
        </button>
      </div>

      <div className="panechat__body" ref={bodyRef} onScroll={onScroll}>
        {nothingHere ? (
          <div className="panechat__empty">
            <p>This terminal isn’t running Claude yet.</p>
            <div className="panechat__empty-actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={() => paneWriters.write(leafId, 'claude\r')}
              >
                Start Claude
              </button>
              <button className="btn btn--ghost btn--sm" onClick={onShowTerminal}>
                Show terminal
              </button>
            </div>
          </div>
        ) : (
          <>
            <ConversationList messages={messages} />
            {ask && state === 'asking' && <AskCard ask={ask} leafId={leafId} />}
            {state === 'working' && (
              <div className="panechat__working">
                <div className="panechat__working-head">
                  <Loader2 size={12} className="spin" /> Claude is working · {elapsed}s
                </div>
                {tail.length > 0 && <pre className="panechat__tail">{tail.join('\n')}</pre>}
              </div>
            )}
          </>
        )}
      </div>

      {!atBottom && (
        <button className="panechat__jump" onClick={jumpToLatest}>
          <ChevronDown size={14} /> Jump to latest
        </button>
      )}

      <Composer leafId={leafId} disabled={state === 'asking'} onSentPicker={onShowTerminal} />
    </div>
  )
}
