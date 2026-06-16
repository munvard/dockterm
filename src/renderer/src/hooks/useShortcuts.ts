import { useEffect } from 'react'
import { useAppStore } from '../state/useAppStore'
import { useEditorStore } from '../state/useEditorStore'
import type { PanelId } from '@shared/types'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/**
 * Global, platform-adaptive shortcuts that never steal keys the shell/TUI needs:
 * macOS uses Cmd+letter (the OS keeps these from the PTY); Windows/Linux uses
 * Ctrl+Shift+letter (plain Ctrl+letter is left for the shell). Ctrl/Cmd+W only
 * acts when the editor has focus.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const app = useAppStore.getState()
      const key = e.key.toLowerCase()
      const cmdOnly = isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
      const ctrlShift = !isMac && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey
      const withShift = isMac
        ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey

      const fire = (fn: () => void): void => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }

      const panel = (letter: string, id: PanelId): boolean => {
        if ((cmdOnly && key === letter) || (ctrlShift && key === letter)) {
          fire(() => app.togglePanel(id))
          return true
        }
        return false
      }

      if (panel('b', 'files')) return
      if (panel('g', 'git')) return
      if (panel('r', 'review')) return
      if (withShift && key === 'm') return fire(() => app.togglePanel('mcp'))
      if ((cmdOnly || ctrlShift) && key === 'j') return fire(() => app.toggleMiniTerm())
      if ((cmdOnly || ctrlShift) && key === 'o') return fire(() => void app.openProjectDialog())

      // Command palette: Cmd/Ctrl+Shift+P, or Cmd+K (mac) / Ctrl+Shift+K (win)
      if ((withShift && key === 'p') || (cmdOnly && key === 'k') || (ctrlShift && key === 'k')) {
        return fire(() => app.setPaletteOpen(!app.paletteOpen))
      }

      // Settings: Cmd+, / Ctrl+,
      if ((isMac ? e.metaKey : e.ctrlKey) && key === ',') {
        return fire(() => app.setOpenPanel('settings'))
      }

      // UI zoom: Cmd/Ctrl + = / - / 0 (resets to 100%). Scales the whole UI.
      const zoomMod = (isMac ? e.metaKey : e.ctrlKey) && !e.altKey
      if (zoomMod) {
        const current = app.settings?.ui.zoom ?? 1.1
        if (key === '=' || key === '+') return fire(() => void app.setZoom(current + 0.1))
        if (key === '-' || key === '_') return fire(() => void app.setZoom(current - 0.1))
        if (key === '0') return fire(() => void app.setZoom(1))
      }

      // Close editor tab (only when the editor is focused).
      const closeCombo = isMac ? cmdOnly : e.ctrlKey && !e.shiftKey && !e.altKey
      if (closeCombo && key === 'w') {
        const inEditor = !!document.activeElement?.closest('.editor')
        const editor = useEditorStore.getState()
        if (inEditor && editor.activePath) fire(() => editor.closeActive())
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
