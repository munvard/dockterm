import { useEffect, useRef, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'

/**
 * A quick scratchpad in the top bar. Opens a small popover with a textarea whose
 * content auto-saves (debounced) to `settings.notes` — no manual save, persisted
 * across sessions and synced to other windows via `settings:changed`.
 */
export function NotesButton() {
  const notes = useAppStore((s) => s.settings?.notes ?? '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(notes)
  // Always holds the latest draft, for the unmount-flush below (a plain effect
  // closure would only see the draft as of mount).
  const draftRef = useRef(draft)
  draftRef.current = draft
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // True while the user is mid-edit, so an incoming settings broadcast (e.g. from
  // another window) doesn't clobber what they're typing here.
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(notes)
  }, [notes])

  // Flush a pending debounced save on unmount instead of just cancelling it —
  // e.g. entering zen mode (which unmounts the whole top bar) within the
  // 350ms debounce window used to silently drop the last edit.
  useEffect(() => {
    return () => {
      if (!saveTimer.current) return
      clearTimeout(saveTimer.current)
      if (editing.current) void window.dockterm.invoke('settings:set', { notes: draftRef.current })
    }
  }, [])

  // Esc closes the popover, matching every other menu/dialog in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onChange = (text: string): void => {
    editing.current = true
    setDraft(text)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      editing.current = false
      void window.dockterm.invoke('settings:set', { notes: text })
    }, 350)
  }

  return (
    <div className="notes">
      <button
        className={`iconbtn tip--end${open ? ' iconbtn--active' : ''}`}
        data-tip="Notes"
        aria-label="Notes"
        onClick={() => setOpen((o) => !o)}
      >
        <StickyNote size={15} />
      </button>
      {open && (
        <>
          <div className="notes__scrim" onClick={() => setOpen(false)} />
          <div className="notes__pop">
            <div className="notes__head">
              <span className="notes__title">Notes</span>
              <span className="notes__hint">auto-saved</span>
            </div>
            <textarea
              className="notes__area"
              value={draft}
              placeholder="Jot anything down — it saves automatically."
              spellCheck={false}
              autoFocus
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  )
}
