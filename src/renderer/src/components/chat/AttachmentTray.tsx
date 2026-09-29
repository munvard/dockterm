import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { File as FileIcon, FileText, Folder, Image as ImageIcon, X } from 'lucide-react'
import { modalRegistry } from '../../state/modalState'
import { useComposeStore } from '../../state/useComposeStore'
import { chipLabel } from './composerPaste'
import type { Attachment, PastedChip } from './composerText'

function Lightbox({ item, onClose }: { item: Attachment; onClose: () => void }): React.ReactElement {
  useEffect(() => {
    modalRegistry.enter()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      modalRegistry.leave()
    }
  }, [onClose])

  return createPortal(
    <div className="lightbox" onMouseDown={onClose}>
      {item.thumb ? (
        <img className="lightbox__img" src={item.thumb} alt={item.name} onMouseDown={(e) => e.stopPropagation()} />
      ) : (
        <div className="lightbox__none" onMouseDown={(e) => e.stopPropagation()}>
          No preview for this image.
          <code>{item.path}</code>
        </div>
      )}
    </div>,
    document.body
  )
}

/**
 * Everything attached to this pane's draft, above the textarea: image chips
 * with thumbnails, file / folder chips, and "Pasted text" chips that expand to
 * view and edit the text (its `[Pasted text #N]` token stays in the message).
 */
export function AttachmentTray({
  leafId,
  attachments,
  chips
}: {
  leafId: string
  attachments: Attachment[]
  chips: PastedChip[]
}): React.ReactElement | null {
  const [preview, setPreview] = useState<Attachment | null>(null)
  const [openChip, setOpenChip] = useState<number | null>(null)
  const chip = chips.find((c) => c.id === openChip) ?? null

  if (attachments.length === 0 && chips.length === 0) return null
  const store = useComposeStore.getState()

  return (
    <div className="composer__attach">
      <div className="composer__tray">
        {attachments.map((a) => (
          <div key={a.id} className={`achip achip--${a.kind}`} title={a.path}>
            {a.kind === 'image' ? (
              <button className="achip__thumb" onClick={() => setPreview(a)} aria-label={`Preview ${a.name}`}>
                {a.thumb ? <img src={a.thumb} alt="" /> : <ImageIcon size={16} />}
              </button>
            ) : (
              <span className="achip__icon">
                {a.kind === 'dir' ? <Folder size={14} /> : <FileIcon size={14} />}
              </span>
            )}
            <span className="achip__name">{a.name}</span>
            <button
              className="achip__x"
              aria-label={`Remove ${a.name}`}
              onClick={() => store.removeAttachment(leafId, a.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {chips.map((c) => (
          <div key={c.id} className={`achip achip--text${openChip === c.id ? ' achip--open' : ''}`}>
            <button
              className="achip__label"
              onClick={() => setOpenChip((cur) => (cur === c.id ? null : c.id))}
              title="View or edit"
            >
              <FileText size={14} /> {chipLabel(c.text)}
            </button>
            <button
              className="achip__x"
              aria-label="Remove pasted text"
              onClick={() => {
                if (openChip === c.id) setOpenChip(null)
                store.removeChip(leafId, c.id)
              }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {chip && (
        <textarea
          className="composer__chipedit"
          value={chip.text}
          spellCheck={false}
          onChange={(e) => useComposeStore.getState().updateChip(leafId, chip.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              setOpenChip(null)
            }
          }}
        />
      )}
      {preview && <Lightbox item={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
