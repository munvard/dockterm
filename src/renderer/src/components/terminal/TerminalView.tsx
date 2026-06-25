import { useEffect, useRef, useState } from 'react'
import { useTerminal, type TerminalOptions } from './useTerminal'
import { useAppStore } from '../../state/useAppStore'
import { SelectionToolbar } from './SelectionToolbar'
import { clampToolbar, wrapBracketedPaste, buildClaudeReference, type Pt } from './terminalSelection'

type Props = TerminalOptions & {
  /** Receives a stable paste function once the terminal mounts (for drag-drop). */
  onPasteReady?: (paste: (text: string) => void) => void
}

const TOOLBAR_SIZE = { w: 168, h: 30 }
const DRAG_PX = 8
// Claude captures the mouse and copies the selection itself; give it a beat after
// the drag ends, then read what it put on the clipboard.
const CLAUDE_COPY_MS = 200

export function TerminalView({ onPasteReady, ...options }: Props) {
  const copyOnSelect = useAppStore((s) => s.settings?.terminal.copyOnSelect) ?? false
  const showToolbar = useAppStore((s) => s.settings?.terminal.selectionToolbar) ?? true

  const hostRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Pt | null>(null)
  const sendRef = useRef('') // the text the toolbar will send

  const term = useTerminal({
    ...options,
    copyOnSelect,
    // When xterm owns the selection (plain shell), hide the toolbar as it clears.
    onSelection: (sel) => {
      if (!sel) setPos(null)
    }
  })
  const termRef = useRef(term)
  termRef.current = term

  useEffect(() => {
    onPasteReady?.(term.paste)
    // term.paste closes over stable refs, so the first instance is valid forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drag-select detection across the whole window (capture phase so xterm and
  // Claude's mouse handling can't swallow it).
  useEffect(() => {
    if (!showToolbar) return
    const down = { x: 0, y: 0, on: false, dragged: false }

    const insideHost = (t: EventTarget | null): boolean =>
      !!hostRef.current && t instanceof Node && hostRef.current.contains(t)
    const onToolbar = (t: EventTarget | null): boolean =>
      t instanceof Element && !!t.closest('.sel-toolbar')

    const show = (text: string, x: number, y: number): void => {
      sendRef.current = text
      setPos(clampToolbar({ x, y }, TOOLBAR_SIZE, { w: window.innerWidth, h: window.innerHeight }))
    }

    const onDown = (e: MouseEvent): void => {
      if (onToolbar(e.target)) return // a click on the toolbar itself
      setPos(null) // any other press dismisses an open toolbar
      down.on = insideHost(e.target)
      down.dragged = false
      down.x = e.clientX
      down.y = e.clientY
    }
    const onMove = (e: MouseEvent): void => {
      if (down.on && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) down.dragged = true
    }
    const onUp = (e: MouseEvent): void => {
      const wasDrag = down.on && down.dragged
      down.on = false
      if (!insideHost(e.target)) return
      const sel = termRef.current.getSelection()
      if (sel) {
        show(sel, e.clientX, e.clientY) // xterm's own selection (plain shell)
        return
      }
      if (!wasDrag) return
      // Claude grabbed the mouse + copied — read its clipboard shortly after.
      const x = e.clientX
      const y = e.clientY
      window.setTimeout(() => {
        void window.dockterm.invoke('clipboard:read', undefined).then((r) => {
          const t = r.ok ? r.value.trim() : ''
          if (t) show(t, x, y)
        })
      }, CLAUDE_COPY_MS)
    }

    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseup', onUp, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseup', onUp, true)
    }
  }, [showToolbar])

  return (
    <div className="terminal" ref={hostRef}>
      <div className="terminal__surface" ref={term.containerRef} />
      {pos && (
        <SelectionToolbar
          pos={pos}
          onSend={() => {
            if (sendRef.current)
              termRef.current.paste(wrapBracketedPaste(buildClaudeReference(sendRef.current)))
            setPos(null)
          }}
          onCopy={() => {
            if (sendRef.current) void navigator.clipboard.writeText(sendRef.current)
            setPos(null)
          }}
        />
      )}
    </div>
  )
}
