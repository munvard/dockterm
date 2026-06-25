import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFilePreviewStore } from '../../state/useFilePreviewStore'
import { useChangesStore } from '../../state/useChangesStore'
import { previewKindFor } from './previewKind'
import { renderMarkdownPreview } from './markdown'
import { buildPreviewDiff, type PreviewDiffLine } from './previewDiff'
import { placePreview } from './terminalSelection'

const CODE_LINES = 40

type Content =
  | { kind: 'loading' }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'markdown'; html: string }
  | { kind: 'code'; text: string }
  | { kind: 'diff'; lines: PreviewDiffLine[] }
  | { kind: 'error'; message: string }

/**
 * A floating, read-only peek at a file path hovered in the terminal. For a file
 * Claude has changed it shows the diff (just the +/− lines); otherwise the file
 * itself — image (sized to its aspect ratio), rendered markdown, or first lines
 * of code. Hover-stable and scrollable so you can actually read it.
 */
export function FilePreviewCard(): React.ReactElement | null {
  const path = useFilePreviewStore((s) => s.path)
  const anchor = useFilePreviewStore((s) => s.anchor)
  const keepOpen = useFilePreviewStore((s) => s.keepOpen)
  const scheduleHide = useFilePreviewStore((s) => s.scheduleHide)
  const changed = useChangesStore((s) =>
    path ? s.files.find((f) => f.relPath === path) ?? null : null
  )
  const [content, setContent] = useState<Content>({ kind: 'loading' })
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    setContent({ kind: 'loading' })
    setPos(null)
    const kind = previewKindFor(path)
    const isChanged = useChangesStore.getState().files.some((f) => f.relPath === path)
    void (async () => {
      if (kind === 'image') {
        const res = await window.dockterm.invoke('fs:readDataUrl', { relPath: path })
        if (cancelled) return
        setContent(res.ok ? { kind: 'image', dataUrl: res.value.dataUrl } : { kind: 'error', message: 'Could not load image' })
        return
      }
      // Changed text file → show the diff (the actual changes) instead of the file.
      if (isChanged) {
        const res = await window.dockterm.invoke('review:diffFile', { base: 'working', relPath: path })
        if (cancelled) return
        if (res.ok) {
          const lines = buildPreviewDiff(res.value.original, res.value.modified)
          setContent(lines.length ? { kind: 'diff', lines } : { kind: 'error', message: 'No line changes' })
        } else {
          setContent({ kind: 'error', message: 'Could not load diff' })
        }
        return
      }
      const res = await window.dockterm.invoke('fs:readFile', { relPath: path })
      if (cancelled) return
      if (!res.ok) {
        setContent({ kind: 'error', message: 'Could not read file' })
        return
      }
      const v = res.value
      if (v.kind !== 'text') {
        setContent({ kind: 'error', message: v.kind === 'too-large' ? 'File too large to preview' : 'Binary file' })
        return
      }
      if (kind === 'markdown') setContent({ kind: 'markdown', html: renderMarkdownPreview(v.content) })
      else setContent({ kind: 'code', text: v.content.split('\n').slice(0, CODE_LINES).join('\n') })
    })()
    return () => {
      cancelled = true
    }
  }, [path])

  // Position after render so we know the card's measured size.
  useLayoutEffect(() => {
    if (!path) return
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos(placePreview(anchor, { w: rect.width, h: rect.height }, { w: window.innerWidth, h: window.innerHeight }))
  }, [path, anchor, content])

  if (!path) return null

  return createPortal(
    <div
      ref={cardRef}
      className="filepreview"
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={keepOpen}
      onMouseLeave={scheduleHide}
    >
      <div className="filepreview__head">
        <span className="filepreview__path" title={path}>
          {path}
        </span>
        {changed && (
          <span className="filepreview__badge">
            <span className="filepreview__badge-add">+{changed.insertions}</span>{' '}
            <span className="filepreview__badge-del">−{changed.deletions}</span>
          </span>
        )}
      </div>
      <div className="filepreview__body">
        {content.kind === 'loading' && <div className="filepreview__muted">Loading…</div>}
        {content.kind === 'error' && <div className="filepreview__muted">{content.message}</div>}
        {content.kind === 'image' && <img className="filepreview__img" src={content.dataUrl} alt="" />}
        {content.kind === 'markdown' && (
          <div className="filepreview__md" dangerouslySetInnerHTML={{ __html: content.html }} />
        )}
        {content.kind === 'code' && <pre className="filepreview__code">{content.text}</pre>}
        {content.kind === 'diff' && (
          <div className="filepreview__diff">
            {content.lines.map((l, i) =>
              l.type === 'gap' ? (
                <div key={i} className="filepreview__diffgap">
                  ⋯
                </div>
              ) : (
                <div key={i} className={`filepreview__diffline filepreview__diffline--${l.type}`}>
                  <span className="filepreview__diffsign">{l.type === 'add' ? '+' : '−'}</span>
                  <span className="filepreview__difftext">{l.text || ' '}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
