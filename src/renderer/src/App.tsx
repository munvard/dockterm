import { useEffect } from 'react'
import { useAppStore } from './state/useAppStore'
import { useThemeStore } from './state/useThemeStore'
import { useShortcuts } from './hooks/useShortcuts'
import { useMunuBridge } from './components/munu/useMunuBridge'
import { Shell } from './components/layout/Shell'
import { EmptyState } from './components/common/EmptyState'
import { Toaster } from './components/common/Toaster'
import { DialogHost } from './components/common/DialogHost'
import { UpdatePopup } from './components/common/UpdatePopup'
import { CommandPalette } from './components/command-palette/CommandPalette'

export default function App() {
  const ready = useAppStore((s) => s.ready)
  const project = useAppStore((s) => s.project)
  const themeSel = useAppStore((s) => s.settings?.theme)
  const initTheme = useThemeStore((s) => s.init)
  const init = useAppStore((s) => s.init)

  useShortcuts()
  useMunuBridge()

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
