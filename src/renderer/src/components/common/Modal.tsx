import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { modalRegistry } from '../../state/modalState'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog takes the keyboard for as long as it's open: it moves DOM focus
 * into itself on mount, restores it to whatever had focus before on unmount,
 * and traps Tab so it can't cycle out to the page behind it. Without this,
 * focus stays wherever it was (often the terminal's hidden xterm textarea) and
 * every keystroke — Escape, Enter, plain letters — keeps going to the
 * terminal instead of the dialog that's visibly on top of it.
 */
export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    modalRegistry.enter()
    return () => modalRegistry.leave()
  }, [])

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const container = containerRef.current
    const focusable = container?.querySelector<HTMLElement>(FOCUSABLE)
    ;(focusable ?? container)?.focus()
    return () => {
      previouslyFocused.current?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const container = containerRef.current
      if (!container) return
      const target = e.target as Node | null
      const inside = !!target && container.contains(target)

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }

      if (!inside) {
        // Focus drifted outside the dialog (most likely the terminal still
        // has it) — never let a keystroke reach whatever's behind the modal.
        e.preventDefault()
        e.stopPropagation()
        const focusable = container.querySelector<HTMLElement>(FOCUSABLE)
        ;(focusable ?? container).focus()
        return
      }

      if (e.key === 'Tab') {
        const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (items.length === 0) {
          e.preventDefault()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && target === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && target === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" ref={containerRef} tabIndex={-1} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  )
}
