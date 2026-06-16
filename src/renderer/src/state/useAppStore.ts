import { create } from 'zustand'
import type { Settings, ProjectInfo, RecentProject, PanelId } from '@shared/types'
import type { SettingsPatch } from '@shared/ipc'

interface AppState {
  ready: boolean
  /** False for secondary (⌘N) windows — they don't persist/restore the workspace. */
  isPrimary: boolean
  settings: Settings | null
  project: ProjectInfo | null
  /** Resolved project root of the focused pane — used to build absolute paths. */
  activeRoot: string | null
  recent: RecentProject[]
  openPanel: PanelId | null
  miniTermOpen: boolean
  paletteOpen: boolean
  busy: boolean
  error: string | null

  init: () => Promise<void>
  setActiveRoot: (root: string | null) => void
  setZoom: (factor: number) => Promise<void>
  openProjectDialog: () => Promise<void>
  openProject: (path: string) => Promise<void>
  initGitRepo: () => Promise<void>
  togglePanel: (panel: PanelId) => void
  setOpenPanel: (panel: PanelId | null) => void
  toggleMiniTerm: () => void
  setMiniTermOpen: (open: boolean) => void
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
  openPanel: null,
  miniTermOpen: false,
  paletteOpen: false,
  busy: false,
  error: null,

  init: async () => {
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

  initGitRepo: async () => {
    const project = get().project
    if (!project) return
    const res = await window.dockterm.invoke('project:gitInit', { path: project.path })
    if (res.ok) set({ project: res.value })
  },

  togglePanel: (panel) => set((s) => ({ openPanel: s.openPanel === panel ? null : panel })),
  setOpenPanel: (panel) => set({ openPanel: panel }),
  toggleMiniTerm: () => set((s) => ({ miniTermOpen: !s.miniTermOpen })),
  setMiniTermOpen: (open) => set({ miniTermOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),

  updatePreferences: async (patch) => {
    const res = await window.dockterm.invoke('settings:set', patch)
    if (res.ok) set({ settings: res.value })
  }
}))
