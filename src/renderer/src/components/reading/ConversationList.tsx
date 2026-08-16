import { useLayoutEffect, useRef, useState } from 'react'
import { renderMarkdownPreview } from '../terminal/markdown'
import type { ReadingMessage } from '@shared/types'

// Assistant markdown is immutable once written, so sanitize each message once and
// cache by id — polling re-renders the list but must not re-run marked/DOMPurify.
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

/** Keep a scroll container pinned to the newest content while the user is at the
 * bottom; report when they've scrolled away so a "jump to latest" can appear. */
export function useStickyScroll(depKey: unknown): {
  ref: React.RefObject<HTMLDivElement | null>
  atBottom: boolean
  onScroll: () => void
  jumpToLatest: () => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [depKey, atBottom])
  return {
    ref,
    atBottom,
    onScroll: () => {
      const el = ref.current
      if (!el) return
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40)
    },
    jumpToLatest: () => {
      const el = ref.current
      if (el) el.scrollTop = el.scrollHeight
      setAtBottom(true)
    }
  }
}

/** The rendered conversation rows, shared by the Reading panel and Chat mode. */
export function ConversationList({ messages }: { messages: ReadingMessage[] }): React.ReactElement {
  return (
    <>
      {messages.map((m) =>
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
      )}
    </>
  )
}
