import { create } from 'zustand'
import { addTab, removeTab, reorderTabs, renameTab, type WsState, type WsTab } from './workspace'

let counter = 0
const newId = (): string => `tab-${Date.now().toString(36)}-${(++counter).toString(36)}`

function titleFromCwd(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() || 'Terminal'
}

function persist(state: WsState): void {
  void window.dockterm.invoke('settings:set', {
    workspace: { tabs: state.tabs, activeId: state.activeId }
  })
}

interface WorkspaceStore {
  tabs: WsTab[]
  activeId: string
  /** tabId -> has unseen output while in the background */
  activity: Record<string, boolean>
  ready: boolean

  /** First-time setup for a window: restore persisted tabs, or open one in `cwd`. */
  init: (cwd: string, restored: { tabs: WsTab[]; activeId: string } | null) => void
  /** Replace all tabs with a single fresh terminal in `cwd` (switching projects). */
  resetForProject: (cwd: string) => void
  open: (cwd: string) => void
  close: (id: string) => void
  setActive: (id: string) => void
  rename: (id: string, title: string) => void
  reorder: (from: number, to: number) => void
  markActivity: (id: string) => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => {
  const apply = (next: WsState): void => {
    set({ tabs: next.tabs, activeId: next.activeId })
    persist(next)
  }
  return {
    tabs: [],
    activeId: '',
    activity: {},
    ready: false,

    init: (cwd, restored) => {
      if (restored && restored.tabs.length > 0) {
        set({
          tabs: restored.tabs,
          activeId: restored.tabs.some((t) => t.id === restored.activeId)
            ? restored.activeId
            : restored.tabs[0].id,
          activity: {},
          ready: true
        })
      } else {
        const tab = { id: newId(), title: titleFromCwd(cwd), cwd }
        set({ tabs: [tab], activeId: tab.id, activity: {}, ready: true })
        persist({ tabs: [tab], activeId: tab.id })
      }
    },

    resetForProject: (cwd) => {
      const tab = { id: newId(), title: titleFromCwd(cwd), cwd }
      set({ activity: {} })
      apply({ tabs: [tab], activeId: tab.id })
    },

    open: (cwd) => {
      apply(addTab(get(), { id: newId(), title: titleFromCwd(cwd), cwd }))
    },

    close: (id) => {
      apply(removeTab(get(), id))
      set((s) => {
        if (!(id in s.activity)) return s
        const activity = { ...s.activity }
        delete activity[id]
        return { activity }
      })
    },

    setActive: (id) => {
      set((s) => ({ activeId: id, activity: { ...s.activity, [id]: false } }))
      persist({ tabs: get().tabs, activeId: id })
    },

    rename: (id, title) => apply(renameTab(get(), id, title)),

    reorder: (from, to) => apply(reorderTabs(get(), from, to)),

    markActivity: (id) => {
      if (get().activeId === id) return
      set((s) => (s.activity[id] ? s : { activity: { ...s.activity, [id]: true } }))
    }
  }
})
