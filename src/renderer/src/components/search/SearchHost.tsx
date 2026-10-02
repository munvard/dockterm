import { useEffect } from 'react'
import type { WatchEvent } from '@shared/ipc'
import { useAppStore } from '../../state/useAppStore'
import { useSearchStore } from '../../state/useSearchStore'

const MAX_RELAY = 20_000

/**
 * Headless glue for search: starts the file index when a project opens (so Quick Open
 * is warm by the time anyone presses the key), feeds `search:event` into the store,
 * and relays `fs:watch` batches to the index (the watcher itself stays untouched).
 */
export function SearchHost() {
  const activeRoot = useAppStore((s) => s.activeRoot)

  useEffect(() => {
    useSearchStore.setState({ index: null })
    useSearchStore.getState().clearFind()
    if (!activeRoot) return
    let alive = true
    void window.dockterm.invoke('search:status', undefined).then((r) => {
      if (alive && r.ok) useSearchStore.getState().setIndex(r.value)
    })
    return () => {
      alive = false
    }
  }, [activeRoot])

  useEffect(() => window.dockterm.on('search:event', (e) => useSearchStore.getState().onEvent(e)), [])

  useEffect(
    () =>
      window.dockterm.on('fs:watch', (batch) => {
        const events: WatchEvent[] = batch.events
        if (events.length > MAX_RELAY) void window.dockterm.invoke('search:refresh', undefined)
        else if (events.length) void window.dockterm.invoke('search:applyWatch', { events })
      }),
    []
  )

  return null
}
