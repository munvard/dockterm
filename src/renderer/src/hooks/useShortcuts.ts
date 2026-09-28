import { useEffect } from 'react'
import { useAppStore } from '../state/useAppStore'
import { useEditorStore } from '../state/useEditorStore'
import { useWorkspaceStore } from '../state/useWorkspaceStore'
import { useComposeStore } from '../state/useComposeStore'
import { useDialogStore } from '../state/useDialogStore'
import { confirmCloseLeaves } from '../components/terminal/closeGuard'
import { refocusIfTerminal } from '../components/terminal/PaneTree'
import { detectPlatform, matchShortcut } from './keys'

const platform = detectPlatform()

/**
 * The ONE global, platform-adaptive shortcut registry. See ./keys.ts
 * (matchShortcut) for the actual key -> shortcut mapping and the modifier
 * rules; this hook only resolves a match against the app's stores. Nothing
 * else in the renderer should add a second window keydown capture listener —
 * two capture listeners on the same target both fire for one keypress and
 * can act twice (or race) on it.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // A confirm/prompt dialog owns the keyboard while it's open (Modal
      // traps focus) — never let a global shortcut act on the app underneath
      // it, e.g. a second "close" firing while one is already pending.
      const dialogs = useDialogStore.getState()
      if (dialogs.confirmState || dialogs.promptState) return

      const matched = matchShortcut(e, platform)
      if (!matched) return

      const app = useAppStore.getState()
      const ws = useWorkspaceStore.getState()

      const fire = (fn: () => void): void => {
        e.preventDefault()
        e.stopPropagation()
        fn()
      }

      switch (matched.id) {
        case 'panel:files':
          return fire(() => app.togglePanel('files'))
        case 'panel:git':
          return fire(() => app.togglePanel('git'))
        case 'panel:review':
          return fire(() => app.togglePanel('review'))
        case 'panel:mcp':
          return fire(() => app.togglePanel('mcp'))
        case 'toggleMiniTerm':
          return fire(() => app.toggleMiniTerm())
        case 'openProject':
          return fire(() => void app.openProjectDialog())
        case 'newTab': {
          const cwd = app.activeRoot || app.homeDir
          if (cwd) fire(() => ws.open(cwd))
          return
        }
        case 'newWindow':
          return fire(() => void window.dockterm.invoke('window:new', undefined))
        case 'splitRight':
          return fire(() => ws.splitFocused('row'))
        case 'toggleChat': {
          const tab = ws.tabs.find((t) => t.id === ws.activeId)
          const leafId = tab?.focusedLeafId
          if (!leafId) return
          return fire(() => {
            const fallback = app.settings?.chat.defaultMode ?? 'terminal'
            ws.togglePaneView(leafId, fallback)
            refocusIfTerminal(leafId) // back to the terminal → give it the keyboard
          })
        }
        case 'toggleZen':
          return fire(() => app.toggleZen())
        case 'palette':
          return fire(() => app.setPaletteOpen(!app.paletteOpen))
        case 'compose':
          return fire(() => useComposeStore.getState().openCompose())
        case 'settings':
          return fire(() => app.setOpenPanel('settings'))
        case 'zoomIn': {
          const current = app.settings?.ui.zoom ?? 1.1
          return fire(() => void app.setZoom(current + 0.1))
        }
        case 'zoomOut': {
          const current = app.settings?.ui.zoom ?? 1.1
          return fire(() => void app.setZoom(current - 0.1))
        }
        case 'zoomReset':
          return fire(() => void app.setZoom(1))
        case 'switchTab': {
          const tab = ws.tabs[matched.tabIndex ?? -1]
          if (tab) fire(() => ws.setActive(tab.id))
          return
        }
        case 'close': {
          // Editor focused -> close the editor tab. Otherwise -> close the
          // focused terminal pane, confirming first if it's still running
          // something. Closing a whole TAB (all its panes) is a separate
          // action (TabStrip's ✕, or the menu's Close Tab) that confirms
          // against every leaf in it, not just the focused one.
          const inEditor = !!document.activeElement?.closest('.editor')
          const editor = useEditorStore.getState()
          if (inEditor && editor.activePath) {
            return fire(() => editor.closeActive())
          }
          const tab = ws.tabs.find((t) => t.id === ws.activeId)
          const leafId = tab?.focusedLeafId
          if (!leafId) return
          fire(() => {
            void confirmCloseLeaves([leafId]).then((proceed) => {
              if (proceed) useWorkspaceStore.getState().closeFocused()
            })
          })
          return
        }
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
