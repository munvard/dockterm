/** Pure editor-tab helpers (no window.dockterm, no React — fully unit-tested).
 * useEditorStore.ts wraps these with the actual IPC calls and zustand state. */
import { languageForFile } from '../components/editor/language'

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

export interface EditorTabsState {
  tabs: EditorTab[]
  activePath: string | null
  goto: { relPath: string; line: number } | null
}

/** Repoint an open tab's relPath/name in place (a FileTree rename), keeping
 * its content/dirty state — used instead of close+reopen, which used to
 * silently discard unsaved edits by re-reading the (now-moved) file fresh
 * from disk under its new name. */
export function renameEditorTab(
  s: EditorTabsState,
  fromRelPath: string,
  toRelPath: string,
  name: string
): EditorTabsState {
  return {
    tabs: s.tabs.map((t) =>
      t.relPath === fromRelPath
        ? {
            ...t,
            relPath: toRelPath,
            name,
            language: t.kind === 'text' ? languageForFile(name) : t.language
          }
        : t
    ),
    activePath: s.activePath === fromRelPath ? toRelPath : s.activePath,
    goto: s.goto && s.goto.relPath === fromRelPath ? { ...s.goto, relPath: toRelPath } : s.goto
  }
}
