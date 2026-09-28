import { create } from 'zustand'
import type { PaneViewMode } from '@shared/types'
import { useDialogStore } from './useDialogStore'
import { addTab, removeTab, reorderTabs, renameTab, basenameOf, type WsTab } from './workspace'
import {
  splitLeaf,
  closeLeaf,
  setSizes,
  setLeafCwd,
  swapLeaves,
  firstLeaf,
  findLeaf,
  allLeaves,
  isValidLayout,
  gridPreset,
  type LayoutNode,
  type LeafNode
} from './layout'

let counter = 0
const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${(++counter).toString(36)}`

/** Only the primary window persists/restores its workspace (secondary windows
 * opened with ⌘N are session-scoped). This can flip at runtime: if the primary
 * window closes, main hands the role to a surviving window (see
 * useAppStore's `window:primaryChanged` listener + setPrimary below). */
let isPrimaryWindow = true
/** The project this workspace belongs to — persisted alongside the tabs so a
 * DIFFERENT project restoring later never bleeds this one's terminals into it. */
let currentProjectPath = ''

function titleFromCwd(cwd: string): string {
  return basenameOf(cwd) || 'Terminal'
}
function makeLeaf(cwd: string): LeafNode {
  return { type: 'leaf', id: uid('pane'), cwd, title: titleFromCwd(cwd) }
}
function makeTab(cwd: string): WsTab {
  const leaf = makeLeaf(cwd)
  return { id: uid('tab'), title: titleFromCwd(cwd), layout: leaf, focusedLeafId: leaf.id }
}

// Persisting on every resize/focus/drag used to write the whole settings file
// (and broadcast it to every window, notes payload included) on each event.
// Debounced so a drag-resize or a burst of focus changes coalesces into one write.
const PERSIST_DEBOUNCE_MS = 300
let persistTimer: ReturnType<typeof setTimeout> | null = null

function persist(tabs: WsTab[], activeId: string): void {
  if (!isPrimaryWindow) return
  if (persistTimer) clearTimeout(persistTimer)
  const projectPath = currentProjectPath
  persistTimer = setTimeout(() => {
    persistTimer = null
    void window.dockterm.invoke('settings:set', {
      workspace: {
        tabs: tabs.map((t) => ({
          id: t.id,
          title: t.title,
          layout: t.layout,
          focusedLeafId: t.focusedLeafId
        })),
        activeId,
        projectPath
      }
    })
  }, PERSIST_DEBOUNCE_MS)
}

interface WorkspaceStore {
  tabs: WsTab[]
  activeId: string
  /** tabId -> has unseen output in the background */
  activity: Record<string, boolean>
  /** leafId -> live working directory reported by the shell (OSC 7). Not persisted
   * and kept separate from leaf.cwd (which keys the terminal) so a `cd` never
   * respawns the shell. */
  paneCwd: Record<string, string>
  /** leafId -> live terminal title (OSC 0/2). Not persisted. */
  paneTitle: Record<string, string>
  /** Per-pane view mode (runtime only — panes start from settings.chat.defaultMode). */
  paneView: Record<string, PaneViewMode>
  ready: boolean

  init: (cwd: string, restored: import('@shared/types').WorkspacePersist | null, isPrimary: boolean) => void
  resetForProject: (cwd: string) => void
  /** React to this window's primary/secondary role changing at runtime (a
   * primary-window handoff). */
  setPrimary: (isPrimary: boolean) => void
  open: (cwd: string) => void
  close: (tabId: string) => void
  setActive: (tabId: string) => void
  rename: (tabId: string, title: string) => void
  reorder: (from: number, to: number) => void
  markActivity: (tabId: string) => void

  // pane-level (operate on the active tab's layout)
  splitFocused: (dir: 'row' | 'col') => void
  closeFocused: () => void
  focusPane: (tabId: string, leafId: string) => void
  resizeSplit: (splitId: string, sizes: number[]) => void
  makeGrid: (rows: number, cols: number) => Promise<void>
  /** Point one pane at a different folder; its shell respawns there. */
  retargetLeaf: (tabId: string, leafId: string, cwd: string) => void
  /** Swap two panes' positions in a tab's layout (drag-to-reorder). */
  swapLeaves: (tabId: string, aLeafId: string, bLeafId: string) => void
  /** Record a pane's live working directory (from OSC 7). */
  setPaneCwd: (leafId: string, cwd: string) => void
  /** Record a pane's live terminal title (from OSC 0/2). */
  setPaneTitle: (leafId: string, title: string) => void
  setPaneView: (leafId: string, mode: PaneViewMode) => void
  togglePaneView: (leafId: string, fallback: PaneViewMode) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const commit = (tabs: WsTab[], activeId: string): void => {
    set({ tabs, activeId })
    persist(tabs, activeId)
  }
  const mapActive = (fn: (tab: WsTab) => WsTab): void => {
    const { tabs, activeId } = get()
    const next = tabs.map((t) => (t.id === activeId ? fn(t) : t))
    commit(next, activeId)
  }
  const focusedCwd = (tab: WsTab): string =>
    findLeaf(tab.layout, tab.focusedLeafId)?.cwd ?? firstLeaf(tab.layout).cwd

  return {
    tabs: [],
    activeId: '',
    activity: {},
    paneCwd: {},
    paneTitle: {},
    paneView: {},
    ready: false,

    init: (cwd, restored, isPrimary) => {
      isPrimaryWindow = isPrimary
      currentProjectPath = cwd
      // A saved workspace only belongs to the project it was saved for. Restoring
      // it regardless used to bleed one project's terminal tabs (and cwds) into a
      // DIFFERENT project opened later in the same (or a newly-primary) window —
      // an older persisted file with no projectPath at all is treated the same as
      // a mismatch (don't restore) rather than "restore regardless".
      const projectMatches = restored?.projectPath === cwd
      if (isPrimary && projectMatches && restored && Array.isArray(restored.tabs) && restored.tabs.length > 0) {
        try {
          const seenLeafIds = new Set<string>()
          const seenTabIds = new Set<string>()
          const tabs: WsTab[] = restored.tabs.map((t) => {
            // Validate the untrusted persisted tree; anything off resets the
            // workspace rather than throwing during render (which, with no error
            // boundary, used to blank the app on every launch).
            if (!t || typeof t.id !== 'string' || typeof t.focusedLeafId !== 'string') {
              throw new Error('bad tab')
            }
            if (!isValidLayout(t.layout)) throw new Error('bad layout')
            const layout = t.layout as LayoutNode
            const leaves = allLeaves(layout)
            if (leaves.length === 0) throw new Error('empty layout')
            // Reject duplicate ids — react-resizable-panels needs unique panel ids.
            if (seenTabIds.has(t.id)) throw new Error('dup tab id')
            seenTabIds.add(t.id)
            for (const l of leaves) {
              if (seenLeafIds.has(l.id)) throw new Error('dup leaf id')
              seenLeafIds.add(l.id)
            }
            // The focused leaf must actually exist in this tab's tree.
            const focusedLeafId = findLeaf(layout, t.focusedLeafId)
              ? t.focusedLeafId
              : firstLeaf(layout).id
            return { id: t.id, title: typeof t.title === 'string' ? t.title : 'Terminal', layout, focusedLeafId }
          })
          const activeId = tabs.some((t) => t.id === restored.activeId)
            ? restored.activeId
            : tabs[0].id
          set({ tabs, activeId, activity: {}, ready: true })
          return
        } catch {
          // corrupt persisted layout — fall through to a fresh tab
        }
      }
      const tab = makeTab(cwd)
      set({ tabs: [tab], activeId: tab.id, activity: {}, ready: true })
      persist([tab], tab.id)
    },

    resetForProject: (cwd) => {
      currentProjectPath = cwd
      const tab = makeTab(cwd)
      set({ activity: {} })
      commit([tab], tab.id)
    },

    setPrimary: (isPrimary) => {
      const wasPrimary = isPrimaryWindow
      isPrimaryWindow = isPrimary
      // Just became primary (the old primary window closed and handed off): the
      // workspace this window already has was never persisted, so save it now —
      // otherwise a relaunch would restore nothing until the next edit.
      if (isPrimary && !wasPrimary) {
        const { tabs, activeId } = get()
        persist(tabs, activeId)
      }
    },

    open: (cwd) => {
      const next = addTab(get(), makeTab(cwd))
      commit(next.tabs, next.activeId)
    },

    close: (tabId) => {
      const closing = get().tabs.find((t) => t.id === tabId)
      const next = removeTab(get(), tabId)
      commit(next.tabs, next.activeId)
      set((s) => {
        const activity = { ...s.activity }
        delete activity[tabId]
        const paneCwd = { ...s.paneCwd }
        const paneTitle = { ...s.paneTitle }
        const paneView = { ...s.paneView }
        if (closing)
          for (const l of allLeaves(closing.layout)) {
            delete paneCwd[l.id]
            delete paneTitle[l.id]
            delete paneView[l.id]
          }
        return { activity, paneCwd, paneTitle, paneView }
      })
    },

    setActive: (tabId) => {
      set((s) => ({ activeId: tabId, activity: { ...s.activity, [tabId]: false } }))
      persist(get().tabs, tabId)
    },

    rename: (tabId, title) => {
      const next = renameTab(get(), tabId, title)
      commit(next.tabs, next.activeId)
    },

    reorder: (from, to) => {
      const next = reorderTabs(get(), from, to)
      commit(next.tabs, next.activeId)
    },

    markActivity: (tabId) => {
      if (get().activeId === tabId) return
      set((s) => (s.activity[tabId] ? s : { activity: { ...s.activity, [tabId]: true } }))
    },

    splitFocused: (dir) =>
      mapActive((tab) => {
        const leaf = makeLeaf(focusedCwd(tab))
        return {
          ...tab,
          layout: splitLeaf(tab.layout, tab.focusedLeafId, dir, leaf, uid('split')),
          focusedLeafId: leaf.id
        }
      }),

    closeFocused: () => {
      const { tabs, activeId } = get()
      const tab = tabs.find((t) => t.id === activeId)
      if (!tab) return
      const closingLeafId = tab.focusedLeafId
      const layout = closeLeaf(tab.layout, tab.focusedLeafId)
      if (layout === null) {
        get().close(activeId)
        return
      }
      const next = tabs.map((t) =>
        t.id === activeId ? { ...t, layout, focusedLeafId: firstLeaf(layout).id } : t
      )
      commit(next, activeId)
      set((s) => {
        const paneCwd = { ...s.paneCwd }
        const paneTitle = { ...s.paneTitle }
        const paneView = { ...s.paneView }
        delete paneCwd[closingLeafId]
        delete paneTitle[closingLeafId]
        delete paneView[closingLeafId]
        return { paneCwd, paneTitle, paneView }
      })
    },

    focusPane: (tabId, leafId) => {
      set((s) => ({
        activeId: tabId,
        activity: { ...s.activity, [tabId]: false },
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, focusedLeafId: leafId } : t))
      }))
      persist(get().tabs, tabId)
    },

    resizeSplit: (splitId, sizes) =>
      mapActive((tab) => ({ ...tab, layout: setSizes(tab.layout, splitId, sizes) })),

    makeGrid: async (rows, cols) => {
      const { tabs, activeId } = get()
      const tab = tabs.find((t) => t.id === activeId)
      if (!tab) return
      const cellCount = rows * cols
      const leafCount = allLeaves(tab.layout).length
      // A grid smaller than the current layout drops the extra panes (and any
      // shell running in them) — confirm first instead of silently killing them.
      if (leafCount > cellCount) {
        const confirmed = await useDialogStore.getState().confirm({
          title: 'Change grid layout',
          message: `This layout has room for ${cellCount} pane${cellCount === 1 ? '' : 's'}, but ${leafCount} are open.`,
          detail: 'The extra panes, and anything running in them, will be closed.',
          confirmLabel: 'Change layout',
          danger: true
        })
        if (!confirmed) return
      }
      mapActive((t) => {
        // Reuse the existing terminals as grid cells so their shells (e.g. a
        // running Claude) are NOT killed. The focused pane becomes the first
        // cell; only the extra cells get fresh shells.
        const cwd = focusedCwd(t)
        const focused = findLeaf(t.layout, t.focusedLeafId)
        const ordered = [
          ...(focused ? [focused] : []),
          ...allLeaves(t.layout).filter((l) => l.id !== focused?.id)
        ]
        let idx = 0
        const nextLeaf = (): LeafNode => {
          const reused = ordered[idx]
          idx += 1
          return reused ?? makeLeaf(cwd)
        }
        const layout = gridPreset(rows, cols, nextLeaf, () => uid('split'))
        const focusedLeafId = focused && findLeaf(layout, focused.id) ? focused.id : firstLeaf(layout).id
        return { ...t, layout, focusedLeafId }
      })
    },

    retargetLeaf: (tabId, leafId, cwd) => {
      const { tabs, activeId } = get()
      const next = tabs.map((t) =>
        t.id === tabId
          ? { ...t, layout: setLeafCwd(t.layout, leafId, cwd, titleFromCwd(cwd)) }
          : t
      )
      // The pane respawns in the new folder; drop any stale live cwd for it.
      set((s) => {
        if (!(leafId in s.paneCwd)) return s
        const paneCwd = { ...s.paneCwd }
        delete paneCwd[leafId]
        return { paneCwd }
      })
      commit(next, activeId)
    },

    swapLeaves: (tabId, aLeafId, bLeafId) => {
      if (aLeafId === bLeafId) return
      const { tabs, activeId } = get()
      const next = tabs.map((t) =>
        t.id === tabId ? { ...t, layout: swapLeaves(t.layout, aLeafId, bLeafId) } : t
      )
      commit(next, activeId)
    },

    setPaneCwd: (leafId, cwd) =>
      set((s) => (s.paneCwd[leafId] === cwd ? s : { paneCwd: { ...s.paneCwd, [leafId]: cwd } })),

    setPaneTitle: (leafId, title) =>
      set((s) =>
        s.paneTitle[leafId] === title ? s : { paneTitle: { ...s.paneTitle, [leafId]: title } }
      ),

    setPaneView: (leafId, mode) => set((s) => ({ paneView: { ...s.paneView, [leafId]: mode } })),
    togglePaneView: (leafId, fallback) =>
      set((s) => {
        const cur = s.paneView[leafId] ?? fallback
        return { paneView: { ...s.paneView, [leafId]: cur === 'chat' ? 'terminal' : 'chat' } }
      })
  }
})
