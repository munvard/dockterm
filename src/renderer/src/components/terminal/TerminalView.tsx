import { useEffect } from 'react'
import { useTerminal, type TerminalOptions } from './useTerminal'

type Props = TerminalOptions & {
  /** Receives a stable paste function once the terminal mounts (for drag-drop). */
  onPasteReady?: (paste: (text: string) => void) => void
}

export function TerminalView({ onPasteReady, ...options }: Props) {
  const term = useTerminal(options)
  useEffect(() => {
    onPasteReady?.(term.paste)
    // term.paste closes over stable refs, so the first instance is valid forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="terminal">
      <div className="terminal__surface" ref={term.containerRef} />
    </div>
  )
}
