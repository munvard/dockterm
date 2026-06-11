import { useTerminal, type TerminalOptions } from './useTerminal'

type Props = TerminalOptions

export function TerminalView(props: Props) {
  const term = useTerminal(props)
  return (
    <div className="terminal">
      <div className="terminal__surface" ref={term.containerRef} />
    </div>
  )
}
