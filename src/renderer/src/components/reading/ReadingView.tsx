import { useEffect } from 'react'
import { BookOpen, X, ChevronDown, PanelRight, PictureInPicture2 } from 'lucide-react'
import { useReadingStore } from '../../state/useReadingStore'
import { useAppStore } from '../../state/useAppStore'
import { getPaneSample } from '../terminal/terminalPool'
import { paneClaudeActive } from '../terminal/paneClaudeActive'
import { ConversationList, conversationDepKey, useStickyScroll } from './ConversationList'

export function ReadingView({
  cwd,
  leafId,
  onHeaderMouseDown
}: {
  cwd: string | null
  leafId: string | null
  onHeaderMouseDown?: (e: React.MouseEvent) => void
}): React.ReactElement {
  // Per-LEAF, matching how main binds transcripts. With no focused leaf we load
  // (and select) the '' key, which is always empty → the empty state renders.
  const conv = useReadingStore((s) => s.byLeaf[leafId ?? ''])
  const load = useReadingStore((s) => s.load)
  const setReadingOpen = useAppStore((s) => s.setReadingOpen)
  const floating = useAppStore((s) => s.settings?.reading.floating) ?? false
  const settings = useAppStore((s) => s.settings)
  const update = useAppStore((s) => s.updatePreferences)
  const toggleFloat = (): void => {
    if (settings) void update({ reading: { ...settings.reading, floating: !floating } })
  }
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
  const { ref: bodyRef, contentRef, atBottom, onScroll, jumpToLatest } = useStickyScroll(
    conversationDepKey(messages)
  )

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
          <div ref={contentRef}>
            <ConversationList messages={messages} />
          </div>
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
