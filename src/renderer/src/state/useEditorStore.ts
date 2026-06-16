import { create } from 'zustand'
import { languageForFile } from '../components/editor/language'
import { useToastStore } from './useToastStore'
import { useDialogStore } from './useDialogStore'

export type EditorTabKind = 'text' | 'image' | 'binary'

export interface EditorTab {
  relPath: string
  name: string
  kind: EditorTabKind
  content: string
  /** image tabs only */
  dataUrl?: string
  /** image/binary tabs */
  size?: number
  mtimeMs: number
  dirty: boolean
  language: string
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

interface EditorState {
  tabs: EditorTab[]
  activePath: string | null
  open: (relPath: string, name: string) => Promise<void>
  close: (relPath: string) => void
  closeActive: () => void
  closeAll: () => void
  setActive: (relPath: string) => void
  markDirty: (relPath: string, dirty: boolean) => void
  save: (relPath: string, content: string) => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,

  open: async (relPath, name) => {
    if (get().tabs.some((t) => t.relPath === relPath)) {
      set({ activePath: relPath })
      return
    }
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const add = (tab: EditorTab): void => set((s) => ({ tabs: [...s.tabs, tab], activePath: relPath }))
    const base = { relPath, name, content: '', mtimeMs: 0, dirty: false, language: '' }

    if (IMAGE_EXT.includes(ext)) {
      const res = await window.dockterm.invoke('fs:readDataUrl', { relPath })
      if (!res.ok) {
        useToastStore.getState().push(res.error.message, 'error')
        return
      }
      add({ ...base, kind: 'image', dataUrl: res.value.dataUrl, size: res.value.size })
      return
    }

    const res = await window.dockterm.invoke('fs:readFile', { relPath })
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return
    }
    const file = res.value
    if (file.kind === 'binary' || file.kind === 'too-large') {
      add({ ...base, kind: 'binary', size: file.size })
      return
    }
    add({
      ...base,
      kind: 'text',
      content: file.content,
      mtimeMs: file.mtimeMs,
      language: languageForFile(name)
    })
  },

  close: (relPath) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.relPath !== relPath)
      const activePath =
        s.activePath === relPath ? (tabs.length ? tabs[tabs.length - 1].relPath : null) : s.activePath
      return { tabs, activePath }
    }),

  closeActive: () => {
    const path = get().activePath
    if (path) get().close(path)
  },

  closeAll: () => set({ tabs: [], activePath: null }),

  setActive: (relPath) => set({ activePath: relPath }),

  markDirty: (relPath, dirty) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, dirty } : t)) })),

  save: async (relPath, content) => {
    const tab = get().tabs.find((t) => t.relPath === relPath)
    if (!tab || tab.kind !== 'text') return

    const res = await window.dockterm.invoke('fs:writeFile', {
      relPath,
      content,
      expectedMtimeMs: tab.mtimeMs
    })
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return
    }
    if (res.value.kind === 'ok') {
      const mtimeMs = res.value.mtimeMs
      set((s) => ({
        tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, dirty: false, content, mtimeMs } : t))
      }))
      return
    }

    // Disk changed under us — never clobber silently.
    const overwrite = await useDialogStore.getState().confirm({
      title: 'File changed on disk',
      message: `"${tab.name}" was modified outside DockTerm since you opened it.`,
      detail: 'Overwrite the version on disk with your edits?',
      confirmLabel: 'Overwrite',
      danger: true
    })
    if (!overwrite) return

    const forced = await window.dockterm.invoke('fs:writeFile', {
      relPath,
      content,
      expectedMtimeMs: null
    })
    if (!forced.ok) {
      useToastStore.getState().push(forced.error.message, 'error')
      return
    }
    if (forced.value.kind === 'ok') {
      const mtimeMs = forced.value.mtimeMs
      set((s) => ({
        tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, dirty: false, content, mtimeMs } : t))
      }))
    }
  }
}))
