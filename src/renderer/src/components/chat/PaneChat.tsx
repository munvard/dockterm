import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useReadingStore } from '../../state/useReadingStore'
import { useMunuStore } from '../../state/useMunuStore'
import { paneWriters } from '../../state/paneWriters'
import { getPaneSample, paneVisibleText } from '../terminal/terminalPool'
import { paneClaudeActive } from '../terminal/paneClaudeActive'
import { ConversationList, conversationDepKey, useStickyScroll } from '../reading/ConversationList'
import { AskCard } from './AskCard'
import { Composer } from './Composer'

const POLL_MS = 700 // chat mode is the primary surface — faster than the side panel
const IDLE_POLL_MS = 2500 // a chat pane on a BACKGROUND tab: keep fresh, stay cheap
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
  active,
  onShowTerminal
}: {
  cwd: string | null
  leafId: string
  /** Whether this pane's TAB is the active one (background tabs poll slower). */
  active: boolean
  onShowTerminal: () => void
}): React.ReactElement {
  const conv = useReadingStore((s) => s.byLeaf[leafId])
  const load = useReadingStore((s) => s.load)
  const pane = useMunuStore((s) => s.panes[leafId])
  const state = pane?.state ?? 'idle'
  const ask = pane?.ask ?? null

  const [tail, setTail] = useState<string[]>([])
  const [workingSince, setWorkingSince] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [claudeHere, setClaudeHere] = useState(true)
  const inFlight = useRef(false)

  const messages = conv?.messages ?? []
  const { ref: bodyRef, contentRef, atBottom, onScroll, jumpToLatest } = useStickyScroll(
    `${conversationDepKey(messages)}:${state === 'asking' && ask ? 1 : 0}:${tail.length}`
  )

  // Poll this pane's conversation. A chat pane stays mounted on inactive tabs, so
  // it backs off there; the in-flight guard keeps a slow disk from stacking calls.
  useEffect(() => {
    if (!cwd) return
    let stop = false
    const refresh = (): void => {
      if (inFlight.current) return
      inFlight.current = true
      const sample = getPaneSample(leafId)
      void paneClaudeActive(leafId)
        .then((live) => {
          if (stop) return
          setClaudeHere(live)
          return load(cwd, leafId, sample, live)
        })
        .finally(() => {
          inFlight.current = false
        })
    }
    refresh()
    const iv = setInterval(refresh, active ? POLL_MS : IDLE_POLL_MS)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [cwd, leafId, load, active])

  // Live raw tail of the hidden terminal while Claude works.
  useEffect(() => {
    if (state !== 'working') {
      setTail([])
      setWorkingSince(null)
      setElapsed(0)
      return
    }
    setWorkingSince((cur) => cur ?? Date.now())
    setElapsed(0)
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
    const tick = (): void => setElapsed(Math.round((Date.now() - workingSince) / 1000))
    tick()
    const iv = setInterval(tick, 500)
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
        {/* No "show the terminal" button here: the floating pane controls sit on top
            of this corner (z-index 6) and already offer that toggle, as does ⌘R. */}
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
          <div ref={contentRef}>
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
          </div>
        )}
      </div>

      {!atBottom && (
        <button className="panechat__jump" onClick={jumpToLatest}>
          <ChevronDown size={14} /> Jump to latest
        </button>
      )}

      {/* Gate on `claudeHere`: without it a prompt is written straight to the shell,
          where backticks / $() / ; / a leading `git` would EXECUTE in the project. */}
      <Composer
        leafId={leafId}
        disabled={state === 'asking' || !claudeHere}
        noClaude={!claudeHere}
        onSentPicker={onShowTerminal}
      />
    </div>
  )
}
