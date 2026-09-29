import { useEffect } from 'react'
import { useAppStore } from './state/useAppStore'
import { useWorkspaceStore } from './state/useWorkspaceStore'
import { useThemeStore } from './state/useThemeStore'
import { useShortcuts } from './hooks/useShortcuts'
import { useMunuBridge } from './components/munu/useMunuBridge'
import { setupTerminalPersistence } from './components/terminal/terminalPersistence'
import { Shell } from './components/layout/Shell'
import { EmptyState } from './components/common/EmptyState'
import { Toaster } from './components/common/Toaster'
import { DialogHost } from './components/common/DialogHost'
import { UpdatePopup } from './components/common/UpdatePopup'
import { CommandPalette } from './components/command-palette/CommandPalette'
import { allLeaves } from './state/layout'
import { confirmCloseLeaves } from './components/terminal/closeGuard'
import { countLiveTerminals } from './components/terminal/liveTerminals'
import { setLiveTerminalCounter } from './state/projectSwitch'

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const project = useAppStore((s) => s.project)
  const themeSel = useAppStore((s) => s.settings?.theme)
  const restoreScrollback = useAppStore((s) => s.settings?.terminal.restoreScrollback) ?? true
  const initTheme = useThemeStore((s) => s.init)
  const init = useAppStore((s) => s.init)

  useShortcuts()
  useMunuBridge()

  // Persist + restore terminal scrollback across a full quit.
  useEffect(() => setupTerminalPersistence(restoreScrollback), [restoreScrollback])

  useEffect(() => {
    setLiveTerminalCounter(countLiveTerminals)
    return () => setLiveTerminalCounter(null)
  }, [])

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    if (themeSel) initTheme(themeSel)
  }, [themeSel, initTheme])

  useEffect(() => {
    void window.dockterm.invoke('app:getInfo', undefined).then((r) => {
      if (r.ok) {
        document.documentElement.dataset.platform = r.value.platform
        useAppStore.setState({ homeDir: r.value.home })
      }
    })
  }, [])

  // Application-menu (File/View) items routed from the main process.
  useEffect(() => {
    return window.dockterm.on('menu:action', ({ action }) => {
      const appState = useAppStore.getState()
      const ws = useWorkspaceStore.getState()
      const projectPath = appState.project?.path
      switch (action) {
        case 'openProject':
          void appState.openProjectDialog()
          break
        case 'settings':
          appState.setOpenPanel('settings')
          break
        case 'newTab':
          if (projectPath) ws.open(projectPath)
          break
        case 'closeTab': {
          // "Close Tab" closes the WHOLE active tab (every pane in it), so it
          // must confirm against every leaf, not just the focused one — same
          // guard as TabStrip's ✕ button.
          const tab = ws.tabs.find((t) => t.id === ws.activeId)
          if (!tab) break
          void confirmCloseLeaves(allLeaves(tab.layout).map((l) => l.id)).then((proceed) => {
            if (proceed) useWorkspaceStore.getState().close(tab.id)
          })
          break
        }
        case 'splitRight':
          ws.splitFocused('row')
          break
        case 'splitDown':
          ws.splitFocused('col')
          break
      }
    })
  }, [])

  return (
    <>
      {!ready ? <div className="app app--loading" /> : project ? <Shell /> : <EmptyState />}
      <Toaster />
      <DialogHost />
      <UpdatePopup />
      <CommandPalette />
    </>
  )
}
