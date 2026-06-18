import { create } from 'zustand'
import { addTab, removeTab, reorderTabs, renameTab, type WsTab } from './workspace'
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
 * opened with ⌘N are session-scoped). */
let isPrimaryWindow = true

function titleFromCwd(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() || 'Terminal'
}
function makeLeaf(cwd: string): LeafNode {
  return { type: 'leaf', id: uid('pane'), cwd, title: titleFromCwd(cwd) }
}
function makeTab(cwd: string): WsTab {
  const leaf = makeLeaf(cwd)
  return { id: uid('tab'), title: titleFromCwd(cwd), layout: leaf, focusedLeafId: leaf.id }
}

function persist(tabs: WsTab[], activeId: string): void {
  if (!isPrimaryWindow) return
  void window.dockterm.invoke('settings:set', {
    workspace: {
      tabs: tabs.map((t) => ({
        id: t.id,
        title: t.title,
        layout: t.layout,
        focusedLeafId: t.focusedLeafId
      })),
      activeId
    }
  })
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
  ready: boolean

  init: (cwd: string, restored: import('@shared/types').WorkspacePersist | null, isPrimary: boolean) => void
  resetForProject: (cwd: string) => void
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
  makeGrid: (rows: number, cols: number) => void
  /** Point one pane at a different folder; its shell respawns there. */
  retargetLeaf: (tabId: string, leafId: string, cwd: string) => void
  /** Swap two panes' positions in a tab's layout (drag-to-reorder). */
  swapLeaves: (tabId: string, aLeafId: string, bLeafId: string) => void
  /** Record a pane's live working directory (from OSC 7). */
  setPaneCwd: (leafId: string, cwd: string) => void
  /** Record a pane's live terminal title (from OSC 0/2). */
  setPaneTitle: (leafId: string, title: string) => void
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
    ready: false,

    init: (cwd, restored, isPrimary) => {
      isPrimaryWindow = isPrimary
      if (isPrimary && restored && Array.isArray(restored.tabs) && restored.tabs.length > 0) {
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
      const tab = makeTab(cwd)
      set({ activity: {} })
      commit([tab], tab.id)
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
        if (closing)
          for (const l of allLeaves(closing.layout)) {
            delete paneCwd[l.id]
            delete paneTitle[l.id]
          }
        return { activity, paneCwd, paneTitle }
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
        delete paneCwd[closingLeafId]
        delete paneTitle[closingLeafId]
        return { paneCwd, paneTitle }
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

    makeGrid: (rows, cols) =>
      mapActive((tab) => {
        // Reuse the existing terminals as grid cells so their shells (e.g. a
        // running Claude) are NOT killed. The focused pane becomes the first
        // cell; only the extra cells get fresh shells. Panes beyond the grid's
        // capacity are dropped (the grid is smaller than the current layout).
        const cwd = focusedCwd(tab)
        const focused = findLeaf(tab.layout, tab.focusedLeafId)
        const ordered = [
          ...(focused ? [focused] : []),
          ...allLeaves(tab.layout).filter((l) => l.id !== focused?.id)
        ]
        let idx = 0
        const nextLeaf = (): LeafNode => {
          const reused = ordered[idx]
          idx += 1
          return reused ?? makeLeaf(cwd)
        }
        const layout = gridPreset(rows, cols, nextLeaf, () => uid('split'))
        const focusedLeafId = focused && findLeaf(layout, focused.id) ? focused.id : firstLeaf(layout).id
        return { ...tab, layout, focusedLeafId }
      }),

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
      )
  }
})
