import { TerminalView } from './components/terminal/TerminalView'

export default function App() {
  return (
    <div className="app">
      <div className="app__body">
        <TerminalView kind="main" />
      </div>
    </div>
  )
}
