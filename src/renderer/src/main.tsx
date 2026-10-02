import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import { motionGovernor } from './components/common/motionGovernor'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/usage.css'

motionGovernor()

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

// NB: intentionally NOT wrapped in <StrictMode>. In development StrictMode
// double-invokes effects, which mounts the terminal twice — that spawns a second
// PTY and immediately kills it, and on Windows the node-pty ConPTY kill path forks
// a console-list helper that can throw "AttachConsole failed" and crash the main
// process. The effects here own real OS resources (shells, watchers), so the
// double-invoke is actively harmful rather than a useful check.
createRoot(container).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
