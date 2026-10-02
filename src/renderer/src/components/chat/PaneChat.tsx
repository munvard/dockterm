import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useReadingStore } from '../../state/useReadingStore'
import { useMunuStore } from '../../state/useMunuStore'
import { paneWriters } from '../../state/paneWriters'
import { getPaneSample, paneClaudeFlag, paneVisibleText, setPaneChatView } from '../terminal/terminalPool'
import { launchCommand } from '../terminal/launcherCommands'
import { paneClaudeActive, paneClaudeForeground } from '../terminal/paneClaudeActive'
import { ConversationList, conversationDepKey, useStickyScroll } from '../reading/ConversationList'
import { AskCard } from './AskCard'
import { Composer } from './Composer'
import { attachPaths, dropHasAttachable, leafRoot, pathsFromDrop } from './composerActions'
import { useToastStore } from '../../state/useToastStore'
import { useComposeStore } from '../../state/useComposeStore'
import { clearClaudeInput, paneClaudeInput } from '../../state/sendComposed'
import { isSending, isVoiceActive, markClaudeLaunch, recentlyLaunched } from '../../state/launchTracker'
import { StrayNotice } from './StrayNotice'
import { parseModelLine, projectName } from './welcome'
import { k } from '../../hooks/keys'

const POLL_MS = 700 // chat mode is the primary surface — faster than the side panel
const IDLE_POLL_MS = 2500 // a chat pane on a BACKGROUND tab: keep fresh, stay cheap
const TAIL_MS = 300 // local buffer read, no IPC
const STARTING_POLL_MS = 300 // right after Start Claude: notice Claude the moment it draws
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
  // Strict: Claude is the FOREGROUND program right now. Gates everything the composer types.
  const [claudeFg, setClaudeFg] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stray, setStray] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [headPad, setHeadPad] = useState(0)
  const strayPrev = useRef<string | null>(null)
  const headRef = useRef<HTMLDivElement | null>(null)
  const inFlight = useRef(false)
  const [dropOver, setDropOver] = useState(false)

  // The terminal is hidden behind this view: it must not hold the keyboard.
  useEffect(() => {
    setPaneChatView(leafId, true)
    return () => setPaneChatView(leafId, false)
  }, [leafId])

  // Keep the header status clear of the floating pane controls (top right).
  useEffect(() => {
    const bar = headRef.current?.closest('.pane')?.querySelector<HTMLElement>('.pane__controls')
    if (!bar) return
    const measure = (): void => setHeadPad(bar.offsetWidth + 14)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

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

  // The composer may only type into this pane while Claude is really in front there.
  useEffect(() => {
    let stop = false
    const check = (): void => {
      void paneClaudeForeground(leafId).then((fg) => {
        if (stop) return
        setClaudeFg(fg)
        setStarting(!fg && recentlyLaunched(leafId))
        if (!fg) {
          strayPrev.current = null
          setStray(null)
          return
        }
        const screen = paneVisibleText(leafId)
        const parsed = parseModelLine(screen)
        if (parsed) setModel((cur) => cur ?? parsed)
        // Text left in Claude's own box: show it only once it has been there for two
        // polls, and never while this app is itself typing into it.
        const box = isSending(leafId) || isVoiceActive(leafId) ? null : paneClaudeInput(leafId)
        if (box && box.trim()) {
          if (strayPrev.current === box) setStray(box)
          else strayPrev.current = box
        } else {
          strayPrev.current = null
          setStray(null)
        }
      })
    }
    check()
    const iv = setInterval(check, starting ? STARTING_POLL_MS : active ? POLL_MS : IDLE_POLL_MS)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [leafId, active, starting])

  const moveStray = (): void => {
    const text = stray
    if (!text) return
    void clearClaudeInput(leafId).then((ok) => {
      if (!ok) {
        useToastStore.getState().push('Claude’s input box would not clear. Clear it in the terminal.', 'warning')
        return
      }
      const store = useComposeStore.getState()
      const draft = store.drafts[leafId] ?? ''
      store.setDraftFor(leafId, draft ? `${text}\n${draft}` : text)
      strayPrev.current = null
      setStray(null)
    })
  }
  const clearStray = (): void => {
    void clearClaudeInput(leafId).then((ok) => {
      if (!ok) useToastStore.getState().push('Claude’s input box would not clear. Clear it in the terminal.', 'warning')
      else {
        strayPrev.current = null
        setStray(null)
      }
    })
  }

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
    <div
      className={`panechat${dropOver ? ' panechat--drop' : ''}`}
      // Files and file-tree drags land in the composer as attachments. Anything
      // else (plain text) still bubbles to the pane's own drop handler.
      onDragOver={(e) => {
        if (!dropHasAttachable(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropOver) setDropOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false)
      }}
      onDrop={(e) => {
        if (!dropHasAttachable(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        setDropOver(false)
        const paths = pathsFromDrop(e.dataTransfer, leafRoot(leafId))
        if (paths.length === 0) useToastStore.getState().push('Could not read the dropped item.', 'warning')
        else void attachPaths(leafId, paths)
      }}
    >
      <div className="panechat__head" ref={headRef} style={{ paddingRight: headPad || undefined }}>
        <span className="panechat__status">
          {state === 'working' && <Loader2 size={12} className="spin" />}
          {state === 'working' ? `working · ${elapsed}s` : state === 'asking' ? 'needs you' : 'ready'}
        </span>
        {/* No "show the terminal" button here: the floating pane controls sit on top
            of this corner (z-index 6) and already offer that toggle, as does ⌘R. */}
      </div>

      <div className="panechat__body" ref={bodyRef} onScroll={onScroll}>
        {nothingHere && starting ? (
          <div className="panechat__empty">
            <p>
              <Loader2 size={13} className="spin" /> Starting Claude…
            </p>
          </div>
        ) : nothingHere ? (
          <div className="panechat__empty">
            <p>This terminal isn’t running Claude yet.</p>
            <div className="panechat__empty-actions">
              <button
                className="btn btn--primary btn--sm"
                onClick={() => {
                  markClaudeLaunch(leafId)
                  setStarting(true)
                  paneWriters.write(leafId, launchCommand('new', paneClaudeFlag(leafId)))
                }}
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
            {messages.length === 0 && state !== 'working' && !(ask && state === 'asking') && (
              <div className="panechat__welcome">
                <div className="panechat__welcome-project">{projectName(cwd) || 'Claude'}</div>
                {model && <div className="panechat__welcome-model">{model}</div>}
                <ul className="panechat__welcome-hints">
                  <li>Enter to send</li>
                  <li>/ for commands</li>
                  <li>@ for files</li>
                  <li>{k('⌘R', 'Ctrl+Shift+R')} for the terminal</li>
                </ul>
              </div>
            )}
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

      {/* Gate on `claudeFg` (fail closed): without it a prompt is written straight to a
          shell or another program, where backticks / $() / ; / a leading `git` would
          EXECUTE in the project. Send checks again right before every write. */}
      {stray && <StrayNotice onMove={moveStray} onClear={clearStray} />}
      <Composer
        leafId={leafId}
        disabled={state === 'asking' || !claudeFg}
        noClaude={!claudeFg}
        starting={starting}
        onSentPicker={onShowTerminal}
      />
    </div>
  )
}
