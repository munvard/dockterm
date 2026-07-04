import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, X, ChevronDown, PanelRight, PictureInPicture2 } from 'lucide-react'
import { useReadingStore, normalizeReadingCwd } from '../../state/useReadingStore'
import { useAppStore } from '../../state/useAppStore'
import { renderMarkdownPreview } from '../terminal/markdown'
import { getPaneSample } from '../terminal/terminalPool'
import { paneClaudeActive } from '../terminal/paneClaudeActive'
import type { ReadingMessage } from '@shared/types'

// Assistant markdown is immutable once written, so sanitize each message once and
// cache by id — the 2.5s poll re-renders the list but must not re-run marked/DOMPurify.
const mdCache = new Map<string, string>()
function renderAssistant(id: string, text: string): string {
  const hit = mdCache.get(id)
  if (hit !== undefined) return hit
  const html = renderMarkdownPreview(text)
  if (mdCache.size > 2000) mdCache.clear() // bound memory across long/many sessions
  mdCache.set(id, html)
  return html
}

const TOOL_ICON: Record<string, string> = {
  Edit: '✎', Write: '＋', Read: '👁', NotebookEdit: '✎', Bash: '⌘', Agent: '⚇', Task: '⚇'
}

function ToolRow({ m }: { m: ReadingMessage }): React.ReactElement {
  const t = m.tool!
  const state = t.ok === null ? 'run' : t.ok ? 'ok' : 'fail'
  return (
    <div className={`reading__tool reading__tool--${state}`}>
      <span className="reading__tool-icon">{TOOL_ICON[t.name] ?? '•'}</span>
      <span className="reading__tool-name">{t.name}</span>
      <span className="reading__tool-summary">{t.summary}</span>
    </div>
  )
}

export function ReadingView({
  cwd,
  leafId,
  onHeaderMouseDown
}: {
  cwd: string | null
  leafId: string | null
  onHeaderMouseDown?: (e: React.MouseEvent) => void
}): React.ReactElement {
  const conv = useReadingStore((s) => (cwd ? s.byCwd[normalizeReadingCwd(cwd)] : undefined))
  const load = useReadingStore((s) => s.load)
  const setReadingOpen = useAppStore((s) => s.setReadingOpen)
  const floating = useAppStore((s) => s.settings?.reading.floating) ?? false
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updatePreferences)
  const toggleFloat = (): void => {
    if (settings) void update({ reading: { ...settings.reading, floating: !floating } })
  }
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)

  // Poll the focused pane's conversation, like the checkpoints rail (2.5s).
  useEffect(() => {
    if (!cwd) return
    let stop = false
    const refresh = (): void => {
      const sample = leafId ? getPaneSample(leafId) : []
      if (!leafId) {
        void load(cwd, '', sample, false)
        return
      }
      void paneClaudeActive(leafId).then((active) => {
        if (!stop) void load(cwd, leafId, sample, active)
      })
    }
    refresh()
    const iv = setInterval(refresh, 2500)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [cwd, leafId, load])

  const messages = conv?.messages ?? []

  // Auto-scroll to the newest message while the user is already at the bottom.
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [messages.length, atBottom])

  const onScroll = (): void => {
    const el = bodyRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
  }
  const jumpToLatest = (): void => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }

  return (
    <div className="reading">
      <div className="reading__head" onMouseDown={onHeaderMouseDown}>
        <span className="reading__title">
          <BookOpen size={13} /> Reading
        </span>
        <div className="reading__head-actions">
          <button
            className="iconbtn iconbtn--sm"
            title={floating ? 'Dock to the side' : 'Float (move & resize)'}
            onClick={toggleFloat}
          >
            {floating ? <PanelRight size={14} /> : <PictureInPicture2 size={14} />}
          </button>
          <button className="iconbtn iconbtn--sm" title="Hide reading view" onClick={() => setReadingOpen(false)}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="reading__body" ref={bodyRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="reading__empty">
            No Claude conversation here yet — run <code>claude</code> in this terminal to start.
          </div>
        ) : (
          messages.map((m) =>
            m.role === 'tool' ? (
              <ToolRow key={m.id} m={m} />
            ) : m.role === 'user' ? (
              <div className="reading__msg reading__msg--user" key={m.id}>
                <div className="reading__role">You</div>
                <div className="reading__text">{m.text}</div>
              </div>
            ) : (
              <div className="reading__msg reading__msg--assistant" key={m.id}>
                <div
                  className="reading__md"
                  dangerouslySetInnerHTML={{ __html: renderAssistant(m.id, m.text ?? '') }}
                />
              </div>
            )
          )
        )}
      </div>
      {!atBottom && (
        <button className="reading__jump" onClick={jumpToLatest}>
          <ChevronDown size={14} /> Jump to latest
        </button>
      )}
    </div>
  )
}
