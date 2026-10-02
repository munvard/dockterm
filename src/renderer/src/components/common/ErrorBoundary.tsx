import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string
}

/**
 * Catches any render/runtime error in the app tree and shows a recovery screen
 * instead of leaving a blank window. Critically, it offers to reset the persisted
 * workspace — a corrupt persisted layout would otherwise re-throw on every launch
 * and leave the app permanently unusable.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in the console so launching from a terminal reveals the stack.
    console.error('[DockTerm] uncaught render error:', error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  private recover = async (hard: boolean): Promise<void> => {
    try {
      await window.dockterm.invoke('app:recover', { hard })
    } catch {
      // even if recovery IPC fails, reload to retry from a clean render
    }
    location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const detail = `${error.message}\n\n${error.stack ?? ''}\n${this.state.info}`.trim()

    return (
      <div className="crash">
        <div className="crash__card">
          <div className="crash__title">DockTerm hit a problem</div>
          <p className="crash__lead">
            Something in the saved session caused an error. Reset it to get back to a working
            window — your files on disk are untouched.
          </p>
          <pre className="crash__detail">{detail}</pre>
          <div className="crash__actions">
            <button className="btn btn--primary" onClick={() => void this.recover(false)}>
              Reset session &amp; reload
            </button>
            <button className="btn btn--ghost" onClick={() => void this.recover(true)}>
              Reset everything
            </button>
            <button className="btn btn--ghost" onClick={() => location.reload()}>
              Just reload
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => void window.dockterm.invoke('clipboard:write', { text: detail })}
            >
              Copy error
            </button>
          </div>
        </div>
      </div>
    )
  }
}
