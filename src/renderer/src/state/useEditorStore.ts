import { create } from 'zustand'
import { languageForFile } from '../components/editor/language'
import { useToastStore } from './useToastStore'
import { useDialogStore } from './useDialogStore'
import { useAppStore } from './useAppStore'

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
  /** The absolute project root this tab was opened under. The window's
   * "active" root follows the focused pane, so a background tab must pin its
   * own root — otherwise a save after focus moves elsewhere would land in the
   * wrong repo (RU-C3). Sent back with fs:readFile/writeFile; main validates
   * it against the window's known roots before trusting it. */
  root: string
  /** Set when the file changed on disk while this tab was dirty, so the
   * change couldn't be silently pulled in (RU-I12). Shown as a banner. */
  staleOnDisk?: boolean
  /** Bumped whenever content is refreshed from disk outside of save() (a
   * silent background reload, or an explicit "Reload" after staleOnDisk) —
   * lets the editor push the new text into an already-open Monaco model
   * without mistaking it for a plain re-render. */
  diskRevision?: number
}

/** The project root a newly-opened tab should be pinned to. */
function currentRoot(): string {
  const s = useAppStore.getState()
  return s.activeRoot ?? s.project?.path ?? ''
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']

interface EditorState {
  tabs: EditorTab[]
  activePath: string | null
  /** A pending "jump to this line" request for the editor (from a clicked path). */
  goto: { relPath: string; line: number } | null
  clearGoto: () => void
  open: (relPath: string, name: string, line?: number) => Promise<void>
  close: (relPath: string) => void
  closeActive: () => void
  closeAll: () => void
  setActive: (relPath: string) => void
  markDirty: (relPath: string, dirty: boolean) => void
  save: (relPath: string, content: string) => Promise<void>
  /** Point an already-open tab at its file's new location in place, keeping
   * its content/dirty state — used after a FileTree rename instead of
   * close+reopen, which used to silently discard unsaved edits. */
  renamePath: (fromRelPath: string, toRelPath: string, name: string) => void
  /** A file this tab has open changed on disk: silently pull in the new
   * content when the tab has no unsaved edits, otherwise just flag it. */
  syncFromDisk: (relPath: string) => Promise<void>
  /** Clear a staleOnDisk flag without reloading (user chose to keep editing). */
  dismissStale: (relPath: string) => void
  /** Explicitly reload from disk, discarding any local edits. */
  reloadFromDisk: (relPath: string) => Promise<void>
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activePath: null,
  goto: null,

  clearGoto: () => set({ goto: null }),

  open: async (relPath, name, line) => {
    if (line != null) set({ goto: { relPath, line } })
    if (get().tabs.some((t) => t.relPath === relPath)) {
      set({ activePath: relPath })
      return
    }
    const root = currentRoot()
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const add = (tab: EditorTab): void => set((s) => ({ tabs: [...s.tabs, tab], activePath: relPath }))
    const base = { relPath, name, content: '', mtimeMs: 0, dirty: false, language: '', root }

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

  renamePath: (fromRelPath, toRelPath, name) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.relPath === fromRelPath
          ? { ...t, relPath: toRelPath, name, language: t.kind === 'text' ? languageForFile(name) : t.language }
          : t
      ),
      activePath: s.activePath === fromRelPath ? toRelPath : s.activePath,
      goto: s.goto && s.goto.relPath === fromRelPath ? { ...s.goto, relPath: toRelPath } : s.goto
    })),

  save: async (relPath, content) => {
    const tab = get().tabs.find((t) => t.relPath === relPath)
    if (!tab || tab.kind !== 'text') return

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
          t.relPath === relPath ? { ...t, dirty: false, content, mtimeMs, staleOnDisk: false } : t
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
          t.relPath === relPath ? { ...t, dirty: false, content, mtimeMs, staleOnDisk: false } : t
        )
      }))
    }
  },

  syncFromDisk: async (relPath) => {
    const tab = get().tabs.find((t) => t.relPath === relPath)
    if (!tab || tab.kind !== 'text') return
    // Never clobber unsaved edits silently — flag it instead, same rule save() follows.
    if (tab.dirty) {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, staleOnDisk: true } : t))
      }))
      return
    }
    const res = await window.dockterm.invoke('fs:readFile', { relPath, root: tab.root })
    if (!res.ok || res.value.kind !== 'text') {
      // Deleted, became binary, or unreadable — surface it the same way rather
      // than pretending nothing happened.
      set((s) => ({
        tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, staleOnDisk: true } : t))
      }))
      return
    }
    const { content, mtimeMs } = res.value
    if (content === tab.content && mtimeMs === tab.mtimeMs) return
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.relPath === relPath
          ? { ...t, content, mtimeMs, staleOnDisk: false, diskRevision: (t.diskRevision ?? 0) + 1 }
          : t
      )
    }))
  },

  dismissStale: (relPath) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.relPath === relPath ? { ...t, staleOnDisk: false } : t)) })),

  reloadFromDisk: async (relPath) => {
    const tab = get().tabs.find((t) => t.relPath === relPath)
    if (!tab || tab.kind !== 'text') return
    const res = await window.dockterm.invoke('fs:readFile', { relPath, root: tab.root })
    if (!res.ok || res.value.kind !== 'text') {
      useToastStore.getState().push(res.ok ? 'That file can no longer be read as text.' : res.error.message, 'error')
      return
    }
    const { content, mtimeMs } = res.value
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.relPath === relPath
          ? { ...t, content, mtimeMs, dirty: false, staleOnDisk: false, diskRevision: (t.diskRevision ?? 0) + 1 }
          : t
      )
    }))
  }
}))
