import { createPortal } from 'react-dom'
import { useToastStore } from '../../state/useToastStore'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const pause = useToastStore((s) => s.pause)
  const resume = useToastStore((s) => s.resume)

  return createPortal(
    <div className="toaster">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          onClick={() => dismiss(t.id)}
          onMouseEnter={() => pause(t.id)}
          onMouseLeave={() => resume(t.id)}
          role="status"
        >
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  )
}
