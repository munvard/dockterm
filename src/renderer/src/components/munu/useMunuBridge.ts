import { useEffect } from 'react'
import { useMunuStore } from '../../state/useMunuStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { answerPane } from '../../state/munuAnswer'
import { actionKeys } from '../terminal/askKeys'

/**
 * Bridges this window's munu state to the main process (which drives the floating
 * overlay + global aggregation) and handles answer/focus requests routed back
 * from the overlay.
 */
export function useMunuBridge(): void {
  // Report this window's aggregate whenever its state, active tab, or focus
  // changes — focus/active-tab affect whether each ask is currently visible.
  // Subscribed outside React so a status change never re-renders the App tree,
  // and an unchanged snapshot is not sent again.
  useEffect(() => {
    let last = ''
    const report = (): void => {
      const snap = useMunuStore.getState().snapshot(useWorkspaceStore.getState().activeId, document.hasFocus())
      const key = JSON.stringify(snap)
      if (key === last) return
      last = key
      void window.dockterm.invoke('munu:report', snap)
    }
    report()
    const offMunu = useMunuStore.subscribe((s, p) => {
      if (s.panes !== p.panes || s.done !== p.done) report()
    })
    const offWs = useWorkspaceStore.subscribe((s, p) => {
      if (s.activeId !== p.activeId) report()
    })
    window.addEventListener('focus', report)
    window.addEventListener('blur', report)
    return () => {
      offMunu()
      offWs()
      window.removeEventListener('focus', report)
      window.removeEventListener('blur', report)
    }
  }, [])

  // The overlay answered the asking pane's menu. Main only forwards a semantic
  // action it has already checked against a one-shot token; THIS window builds the
  // key presses from its own view of the ask, so the overlay never supplies raw
  // bytes for a PTY. A stale or mismatching action is dropped.
  useEffect(
    () =>
      window.dockterm.on('munu:doAnswer', ({ leafId, action }) => {
        const pane = useMunuStore.getState().panes[leafId]
        if (!pane || pane.state !== 'asking' || !pane.ask) return
        const keys = actionKeys(pane.ask, action)
        if (keys?.length) answerPane(leafId, keys)
      }),
    []
  )

  // The overlay asked to jump to the asking pane (window raise handled in main).
  useEffect(
    () =>
      window.dockterm.on('munu:doFocus', ({ tabId, leafId }) => {
        useWorkspaceStore.getState().focusPane(tabId, leafId)
      }),
    []
  )
}
