/** Pure editor-tab helpers (no window.dockterm, no React — fully unit-tested).
 * useEditorStore.ts wraps these with the actual IPC calls and zustand state. */
import { languageForFile } from '../components/editor/language'

export type EditorTabKind = 'text' | 'image' | 'binary'

/** A tab's identity: the project root plus the path inside it. relPath alone
 * collides when two projects both have e.g. `src/index.ts`. */
export function tabKey(root: string, relPath: string): string {
  return `${root}\u0000${relPath}`
}

export interface EditorTab {
  /** tabKey(root, relPath). Changes when the tab is renamed. */
  id: string
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

export interface EditorTabsState {
  tabs: EditorTab[]
  /** The active tab's id (tabKey), not a bare relPath. */
  activeId: string | null
  goto: { id: string; line: number } | null
}

/** Remove a tab; if it was active, the last remaining tab becomes active. */
export function closeEditorTab(s: EditorTabsState, id: string): EditorTabsState {
  const tabs = s.tabs.filter((t) => t.id !== id)
  const activeId = s.activeId === id ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeId
  return { ...s, tabs, activeId }
}

/** Repoint an open tab's relPath/name in place (a FileTree rename in `root`),
 * keeping its content/dirty state — used instead of close+reopen, which used to
 * silently discard unsaved edits by re-reading the (now-moved) file fresh
 * from disk under its new name. Tabs of other roots are never touched. */
export function renameEditorTab(
  s: EditorTabsState,
  root: string,
  fromRelPath: string,
  toRelPath: string,
  name: string
): EditorTabsState {
  const fromId = tabKey(root, fromRelPath)
  const toId = tabKey(root, toRelPath)
  return {
    tabs: s.tabs.map((t) =>
      t.id === fromId
        ? {
            ...t,
            id: toId,
            relPath: toRelPath,
            name,
            language: t.kind === 'text' ? languageForFile(name) : t.language
          }
        : t
    ),
    activeId: s.activeId === fromId ? toId : s.activeId,
    goto: s.goto && s.goto.id === fromId ? { ...s.goto, id: toId } : s.goto
  }
}
