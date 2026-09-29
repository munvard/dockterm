import { create } from 'zustand'
import { languageForFile } from '../components/editor/language'
import { useToastStore } from './useToastStore'
import { useDialogStore } from './useDialogStore'
import { useAppStore } from './useAppStore'
import { renameEditorTab, closeEditorTab, tabKey, type EditorTab, type EditorTabKind } from './editorTabs'

// Re-exported for existing consumers that import the type from here.
export type { EditorTab, EditorTabKind }

/** The project root a newly-opened tab should be pinned to. */
function currentRoot(): string {
  const s = useAppStore.getState()
  return s.activeRoot ?? s.project?.path ?? ''
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

interface EditorState {
  tabs: EditorTab[]
  /** The active tab's id (root + relPath, see tabKey). */
  activeId: string | null
  /** A pending "jump to this line" request for the editor (from a clicked path). */
  goto: { id: string; line: number } | null
  clearGoto: () => void
  /** Open (or focus) a file of the CURRENT project root. */
  open: (relPath: string, name: string, line?: number) => Promise<void>
  /** Close a tab by id, no questions asked. */
  close: (id: string) => void
  /** Close a tab by id, asking first when it has unsaved edits. The one path
   * for the tab's close button and the close shortcut. Resolves true if closed. */
  requestClose: (id: string) => Promise<boolean>
  /** Close the file `relPath` of the current root (no prompt: it was deleted). */
  closeRel: (relPath: string) => void
  closeAll: () => void
  setActive: (id: string) => void
  markDirty: (id: string, dirty: boolean) => void
  save: (id: string, content: string) => Promise<void>
  /** Point an already-open tab at its file's new location in place, keeping
   * its content/dirty state — used after a FileTree rename instead of
   * close+reopen, which used to silently discard unsaved edits. */
  renamePath: (fromRelPath: string, toRelPath: string, name: string) => void
  /** A file this tab has open changed on disk: silently pull in the new
   * content when the tab has no unsaved edits, otherwise just flag it. */
  syncFromDisk: (id: string) => Promise<void>
  /** Clear a staleOnDisk flag without reloading (user chose to keep editing). */
  dismissStale: (id: string) => void
  /** Explicitly reload from disk, discarding any local edits. */
  reloadFromDisk: (id: string) => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeId: null,
  goto: null,

  clearGoto: () => set({ goto: null }),

  open: async (relPath, name, line) => {
    const root = currentRoot()
    const id = tabKey(root, relPath)
    if (line != null) set({ goto: { id, line } })
    if (get().tabs.some((t) => t.id === id)) {
      set({ activeId: id })
      return
    }
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const add = (tab: EditorTab): void =>
      set((s) =>
        // A second open() for the same file can resolve while the first read is
        // still in flight: don't add the tab twice.
        s.tabs.some((t) => t.id === id) ? { activeId: id } : { tabs: [...s.tabs, tab], activeId: id }
      )
    const base = { id, relPath, name, content: '', mtimeMs: 0, dirty: false, language: '', root }

    if (IMAGE_EXT.includes(ext)) {
      const res = await window.dockterm.invoke('fs:readDataUrl', { relPath })
      if (!res.ok) {
        useToastStore.getState().push(res.error.message, 'error')
        return
      }
      add({ ...base, kind: 'image', dataUrl: res.value.dataUrl, size: res.value.size })
      return
    }

    const res = await window.dockterm.invoke('fs:readFile', { relPath, root })
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

  close: (id) => set((s) => closeEditorTab(s, id)),

  requestClose: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return false
    if (tab.dirty) {
      const discard = await useDialogStore.getState().confirm({
        title: 'Unsaved changes',
        message: `"${tab.name}" has unsaved changes. Close it and discard them?`,
        confirmLabel: 'Discard changes',
        danger: true
      })
      if (!discard) return false
    }
    get().close(id)
    return true
  },

  closeRel: (relPath) => get().close(tabKey(currentRoot(), relPath)),

  closeAll: () => set({ tabs: [], activeId: null }),

  setActive: (id) => set({ activeId: id }),

  markDirty: (id, dirty) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })),

  renamePath: (fromRelPath, toRelPath, name) =>
    set((s) => renameEditorTab(s, currentRoot(), fromRelPath, toRelPath, name)),

  save: async (id, content) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.kind !== 'text') return
    const relPath = tab.relPath

    const res = await window.dockterm.invoke('fs:writeFile', {
      relPath,
      content,
      expectedMtimeMs: tab.mtimeMs,
      root: tab.root
    })
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return
    }
    if (res.value.kind === 'ok') {
      const mtimeMs = res.value.mtimeMs
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, dirty: false, content, mtimeMs, staleOnDisk: false } : t
        )
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
      expectedMtimeMs: null,
      root: tab.root
    })
    if (!forced.ok) {
      useToastStore.getState().push(forced.error.message, 'error')
      return
    }
    if (forced.value.kind === 'ok') {
      const mtimeMs = forced.value.mtimeMs
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, dirty: false, content, mtimeMs, staleOnDisk: false } : t
        )
      }))
    }
  },

  syncFromDisk: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.kind !== 'text') return
    const relPath = tab.relPath
    // Never clobber unsaved edits silently — flag it instead, same rule save() follows.
    if (tab.dirty) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, staleOnDisk: true } : t))
      }))
      return
    }
    const res = await window.dockterm.invoke('fs:readFile', { relPath, root: tab.root })
    if (!res.ok || res.value.kind !== 'text') {
      // Deleted, became binary, or unreadable — surface it the same way rather
      // than pretending nothing happened.
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, staleOnDisk: true } : t))
      }))
      return
    }
    const { content, mtimeMs } = res.value
    if (content === tab.content && mtimeMs === tab.mtimeMs) return
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, content, mtimeMs, staleOnDisk: false, diskRevision: (t.diskRevision ?? 0) + 1 }
          : t
      )
    }))
  },

  dismissStale: (id) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, staleOnDisk: false } : t)) })),

  reloadFromDisk: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab || tab.kind !== 'text') return
    const relPath = tab.relPath
    const res = await window.dockterm.invoke('fs:readFile', { relPath, root: tab.root })
    if (!res.ok || res.value.kind !== 'text') {
      useToastStore.getState().push(res.ok ? 'That file can no longer be read as text.' : res.error.message, 'error')
      return
    }
    const { content, mtimeMs } = res.value
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, content, mtimeMs, dirty: false, staleOnDisk: false, diskRevision: (t.diskRevision ?? 0) + 1 }
          : t
      )
    }))
  }
}))
