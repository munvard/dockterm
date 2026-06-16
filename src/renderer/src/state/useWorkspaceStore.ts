import { create } from 'zustand'
import { addTab, removeTab, reorderTabs, renameTab, type WsTab } from './workspace'
import {
  splitLeaf,
  closeLeaf,
  setSizes,
  setLeafCwd,
  firstLeaf,
  findLeaf,
  allLeaves,
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
    ready: false,

    init: (cwd, restored, isPrimary) => {
      isPrimaryWindow = isPrimary
      if (isPrimary && restored && Array.isArray(restored.tabs) && restored.tabs.length > 0) {
        try {
          const tabs: WsTab[] = restored.tabs.map((t) => ({
            id: t.id,
            title: t.title,
            layout: t.layout as LayoutNode,
            focusedLeafId: t.focusedLeafId
          }))
          tabs.forEach((t) => {
            if (allLeaves(t.layout).length === 0) throw new Error('empty layout')
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
      const next = removeTab(get(), tabId)
      commit(next.tabs, next.activeId)
      set((s) => {
        if (!(tabId in s.activity)) return s
        const activity = { ...s.activity }
        delete activity[tabId]
        return { activity }
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
      const layout = closeLeaf(tab.layout, tab.focusedLeafId)
      if (layout === null) {
        get().close(activeId)
        return
      }
      const next = tabs.map((t) =>
        t.id === activeId ? { ...t, layout, focusedLeafId: firstLeaf(layout).id } : t
      )
      commit(next, activeId)
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
        const cwd = focusedCwd(tab)
        const layout = gridPreset(rows, cols, () => makeLeaf(cwd), () => uid('split'))
        return { ...tab, layout, focusedLeafId: firstLeaf(layout).id }
      }),

    retargetLeaf: (tabId, leafId, cwd) => {
      const { tabs, activeId } = get()
      const next = tabs.map((t) =>
        t.id === tabId
          ? { ...t, layout: setLeafCwd(t.layout, leafId, cwd, titleFromCwd(cwd)) }
          : t
      )
      commit(next, activeId)
    }
  }
})
