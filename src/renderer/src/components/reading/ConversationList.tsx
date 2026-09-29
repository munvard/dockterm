import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderMarkdownPreview } from '../terminal/markdown'
import { conversationDepKey } from './conversationDepKey'
import type { ReadingMessage } from '@shared/types'

export { conversationDepKey }

// Assistant markdown is immutable once written, so sanitize each message once and
// cache by id — polling re-renders the list but must not re-run marked/DOMPurify.
const MD_CACHE_MAX = 2000
const mdCache = new Map<string, string>()
function renderAssistant(id: string, text: string): string {
  const hit = mdCache.get(id)
  if (hit !== undefined) return hit
  const html = renderMarkdownPreview(text)
  // Evict the OLDEST half (a Map iterates in insertion order) rather than clearing:
  // a real session exceeds the cap, and clearing would make every subsequent render
  // re-run marked + DOMPurify over the whole visible conversation on each poll.
  if (mdCache.size >= MD_CACHE_MAX) {
    let drop = Math.floor(mdCache.size / 2)
    for (const k of mdCache.keys()) {
      if (drop-- <= 0) break
      mdCache.delete(k)
    }
  }
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

/** Rendered markdown can contain <a href> from the transcript's own prose — open
 * those in the OS browser instead of doing nothing (Electron's renderer has no
 * navigable window.open target) or navigating the app itself away from itself.
 * One delegated listener on the list covers every message, including ones added
 * after the cache above already rendered their HTML. */
function onConversationClick(e: React.MouseEvent<HTMLDivElement>): void {
  const a = (e.target as HTMLElement).closest('a[href]')
  if (!a) return
  const href = a.getAttribute('href') ?? ''
  if (!/^https?:\/\//i.test(href)) return
  e.preventDefault()
  void window.dockterm.invoke('app:openExternal', { url: href })
}

/** Keep a scroll container pinned to the newest content while the user is at the
 * bottom; report when they've scrolled away so a "jump to latest" can appear. */
export function useStickyScroll(depKey: unknown): {
  ref: React.RefObject<HTMLDivElement | null>
  /** Attach to the single element that wraps everything scrollable inside `ref` —
   * a ResizeObserver on it catches content growth `depKey` alone can miss (a code
   * block's late syntax highlighting, a window resize) while the user is pinned.
   * A callback ref (not a plain RefObject): the content wrapper is conditionally
   * rendered (an empty-state card shows before it exists), so the observer has to
   * attach whenever that node actually mounts, not just once on first render. */
  contentRef: (node: HTMLDivElement | null) => void
  atBottom: boolean
  onScroll: () => void
  jumpToLatest: () => void
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => setContentEl(node), [])
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(atBottom)
  atBottomRef.current = atBottom

  useLayoutEffect(() => {
    const el = ref.current
    if (el && atBottom) el.scrollTop = el.scrollHeight
  }, [depKey, atBottom])

  useEffect(() => {
    const el = ref.current
    if (!contentEl || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(contentEl)
    return () => ro.disconnect()
  }, [contentEl])

  return {
    ref,
    contentRef,
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

/** The rendered conversation rows, shared by the Reading panel and Chat mode.
 * Memoized on `messages` (a new array only when main actually parsed something
 * new — see the reading store's revision check) so a parent re-rendering for an
 * unrelated reason (an elapsed-time tick, a working-strip refresh) doesn't
 * re-walk a long conversation for nothing. */
export const ConversationList = memo(function ConversationList({
  messages
}: {
  messages: ReadingMessage[]
}): React.ReactElement {
  return (
    <div onClick={onConversationClick}>
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
    </div>
  )
})
