import { create } from 'zustand'
import type { Settings, ProjectInfo, RecentProject, PanelId } from '@shared/types'
import type { SettingsPatch } from '@shared/ipc'
import { useToastStore } from './useToastStore'
import { askProjectSwitch, isSameProjectPath } from './projectSwitch'

interface AppState {
  ready: boolean
  /** False for secondary (⌘N) windows — they don't persist/restore the workspace. */
  isPrimary: boolean
  settings: Settings | null
  project: ProjectInfo | null
  /** Resolved project root of the focused pane — used to build absolute paths. */
  activeRoot: string | null
  recent: RecentProject[]
  /** The user's home directory (for "open a terminal here"). */
  homeDir: string
  openPanel: PanelId | null
  miniTermOpen: boolean
  zen: boolean
  historyOpen: boolean
  readingOpen: boolean
  paletteOpen: boolean
  busy: boolean
  error: string | null

  init: () => Promise<void>
  setActiveRoot: (root: string | null) => void
  setZoom: (factor: number) => Promise<void>
  openProjectDialog: () => Promise<void>
  openProject: (path: string) => Promise<void>
  refreshRecent: () => Promise<void>
  initGitRepo: () => Promise<void>
  togglePanel: (panel: PanelId) => void
  setOpenPanel: (panel: PanelId | null) => void
  toggleMiniTerm: () => void
  setMiniTermOpen: (open: boolean) => void
  toggleZen: () => void
  setZen: (v: boolean) => void
  toggleHistory: () => void
  toggleReading: () => void
  setReadingOpen: (v: boolean) => void
  setPaletteOpen: (open: boolean) => void
  updatePreferences: (patch: SettingsPatch) => Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  isPrimary: true,
  settings: null,
  project: null,
  activeRoot: null,
  recent: [],
  homeDir: '',
  openPanel: null,
  miniTermOpen: false,
  zen: false,
  historyOpen: false,
  readingOpen: false,
  paletteOpen: false,
  busy: false,
  error: null,

  init: async () => {
    // Main asked this window to open a specific project (a second app launch
    // pointed at a folder, or a Finder/Explorer "open with", or "Open in new
    // window"). Registered before any await so a request that lands right after
    // the page loads is never missed.
    window.dockterm.on('project:openRequested', ({ path }) => {
      void get().openProject(path)
    })
    const [settingsRes, recentRes, primaryRes] = await Promise.all([
      window.dockterm.invoke('settings:get', undefined),
      window.dockterm.invoke('project:getRecent', undefined),
      window.dockterm.invoke('window:isPrimary', undefined)
    ])
    const settings = settingsRes.ok ? settingsRes.value : null
    const isPrimary = primaryRes.ok ? primaryRes.value : true
    set({
      settings,
      recent: recentRes.ok ? recentRes.value : [],
      openPanel: settings?.ui.openPanel ?? null,
      miniTermOpen: settings?.ui.miniTermOpen ?? false,
      isPrimary
    })
    window.dockterm.on('settings:changed', (next) => set({ settings: next }))
    // The window that owns "primary" (workspace persistence, restoring the last
    // project) can hand off at runtime — e.g. the primary window closes and this
    // one becomes primary. Read once at boot above; react to it live here.
    window.dockterm.on('window:primaryChanged', (nowPrimary) => set({ isPrimary: nowPrimary }))
    // Only the primary window restores the last project; secondary (⌘N) windows
    // open project-less and show the welcome screen (Cursor-style).
    const last = settings?.lastProjectPath
    if (last && isPrimary) {
      const res = await window.dockterm.invoke('project:open', { path: last })
      if (res.ok) set({ project: res.value })
    }
    set({ ready: true })
  },

  setActiveRoot: (root) => set({ activeRoot: root }),

  setZoom: async (factor) => {
    const res = await window.dockterm.invoke('ui:setZoom', { factor })
    // The main process broadcasts settings:changed, which updates the store; this
    // local set keeps the settings UI snappy in the meantime.
    if (res.ok) {
      set((s) => (s.settings ? { settings: { ...s.settings, ui: { ...s.settings.ui, zoom: res.value.zoom } } } : s))
    }
  },

  openProjectDialog: async () => {
    const res = await window.dockterm.invoke('project:openDialog', undefined)
    if (res.ok && 'path' in res.value) {
      await get().openProject(res.value.path)
    }
  },

  openProject: async (path) => {
    const current = get().project
    if (current) {
      // Re-opening the open project is a no-op; opening a different one closes
      // this window's terminals, so ask BEFORE anything is torn down.
      if (isSameProjectPath(current.path, path)) return
      const decision = await askProjectSwitch(path)
      if (decision === 'cancel') return
      if (decision === 'new-window') {
        await window.dockterm.invoke('window:new', { path })
        return
      }
    }
    set({ busy: true, error: null })
    const res = await window.dockterm.invoke('project:open', { path })
    if (res.ok) {
      set({ project: res.value, busy: false })
      const recent = await window.dockterm.invoke('project:getRecent', undefined)
      if (recent.ok) set({ recent: recent.value })
    } else {
      set({ error: res.error.message, busy: false })
    }
  },

  refreshRecent: async () => {
    const res = await window.dockterm.invoke('project:getRecent', undefined)
    if (res.ok) set({ recent: res.value })
  },

  initGitRepo: async () => {
    // Initialize in whatever directory the focused pane is in (its resolved
    // root), falling back to the opened project.
    const root = get().activeRoot ?? get().project?.path
    if (!root) return
    const res = await window.dockterm.invoke('project:gitInit', { path: root })
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return
    }
    // Only refresh the opened-project info when we initialized THAT folder.
    if (res.value.path === get().project?.path) set({ project: res.value })
  },

  togglePanel: (panel) => set((s) => ({ openPanel: s.openPanel === panel ? null : panel })),
  setOpenPanel: (panel) => set({ openPanel: panel }),
  toggleMiniTerm: () => set((s) => ({ miniTermOpen: !s.miniTermOpen })),
  setMiniTermOpen: (open) => set({ miniTermOpen: open }),
  toggleZen: () => set((s) => ({ zen: !s.zen })),
  setZen: (v) => set({ zen: v }),
  toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),
  toggleReading: () => set((s) => ({ readingOpen: !s.readingOpen })),
  setReadingOpen: (v) => set({ readingOpen: v }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  updatePreferences: async (patch) => {
    const res = await window.dockterm.invoke('settings:set', patch)
    if (res.ok) set({ settings: res.value })
  }
}))
