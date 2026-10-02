import { create } from 'zustand'
import type { ContentDone, ContentFileResult, IndexStatus, SearchEvent } from '@shared/search/types'
import { useAppStore } from './useAppStore'

const MAX_RECENT = 40
/** Highest search id seen so far: a late event from an older, canceled search must not be adopted by a newer request. */
let lastSeenId = 0
const recentKey = (root: string): string => `dockterm.recentFiles.${root}`

export function readRecent(root: string | null): string[] {
  if (!root) return []
  try {
    const raw = localStorage.getItem(recentKey(root))
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

/** Most recent first, no duplicates, capped. Pure so it is unit-testable. */
export function pushRecentList(list: readonly string[], relPath: string): string[] {
  return [relPath, ...list.filter((p) => p !== relPath)].slice(0, MAX_RECENT)
}

export interface FindRun {
  /** Id of the running or last search; null before the first reply. */
  id: number | null
  /** A search was requested and its first event has not arrived yet. */
  pending: boolean
  running: boolean
  total: number | null
  scanned: number
  files: ContentFileResult[]
  storedLines: number
  done: ContentDone | null
  error: string | null
  startedAt: number
  finishedAt: number
}

const IDLE_RUN: FindRun = {
  id: null,
  pending: false,
  running: false,
  total: null,
  scanned: 0,
  files: [],
  storedLines: 0,
  done: null,
  error: null,
  startedAt: 0,
  finishedAt: 0
}

export interface FindForm {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  include: string
  exclude: string
}

interface SearchState {
  quickOpen: boolean
  index: IndexStatus | null
  find: FindForm
  run: FindRun
  /** Bumps when the Find panel should focus its box (shortcut pressed while it is already open). */
  findFocusTick: number

  openQuick: () => void
  closeQuick: () => void
  setIndex: (s: IndexStatus) => void
  pushRecent: (relPath: string) => void
  setFind: (patch: Partial<FindForm>) => void
  startFind: () => Promise<void>
  cancelFind: () => void
  clearFind: () => void
  focusFind: () => void
  onEvent: (e: SearchEvent) => void
}

export const useSearchStore = create<SearchState>((set, get) => ({
  quickOpen: false,
  index: null,
  find: { query: '', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' },
  run: IDLE_RUN,
  findFocusTick: 0,

  openQuick: () => set({ quickOpen: true }),
  closeQuick: () => set({ quickOpen: false }),
  setIndex: (index) => set({ index }),

  pushRecent: (relPath) => {
    const root = useAppStore.getState().activeRoot
    if (!root) return
    try {
      localStorage.setItem(recentKey(root), JSON.stringify(pushRecentList(readRecent(root), relPath)))
    } catch {
      // storage full or blocked: recents are a nicety
    }
  },

  setFind: (patch) => set((s) => ({ find: { ...s.find, ...patch } })),

  focusFind: () => set((s) => ({ findFocusTick: s.findFocusTick + 1 })),

  startFind: async () => {
    const { find } = get()
    if (!find.query) {
      get().clearFind()
      return
    }
    const includeIgnored = useAppStore.getState().settings?.files.searchIgnored ?? false
    set({ run: { ...IDLE_RUN, pending: true, running: true, startedAt: Date.now() } })
    const res = await window.dockterm.invoke('search:content', { ...find, includeIgnored })
    if (!res.ok) {
      set((s) => (s.run.pending ? { run: { ...IDLE_RUN, error: res.error.message } } : s))
      return
    }
    lastSeenId = Math.max(lastSeenId, res.value.id)
    set((s) => (s.run.id === null && s.run.pending ? { run: { ...s.run, id: res.value.id } } : s))
  },

  cancelFind: () => {
    void window.dockterm.invoke('search:cancel', undefined)
  },

  clearFind: () => {
    void window.dockterm.invoke('search:cancel', undefined)
    set({ run: IDLE_RUN })
  },

  onEvent: (e) => {
    if (e.kind === 'index') {
      if (e.root === useAppStore.getState().activeRoot) set({ index: e.status })
      return
    }
    const { run } = get()
    // A search is ours when it is the id we know, or the first we hear of while one was just requested.
    if (run.id === null ? !run.pending || e.id <= lastSeenId : e.id !== run.id) return
    lastSeenId = Math.max(lastSeenId, e.id)
    if (e.kind === 'content-start') {
      set({ run: { ...run, id: e.id, pending: false, total: e.total } })
    } else if (e.kind === 'content-progress') {
      set({
        run: {
          ...run,
          id: e.id,
          pending: false,
          scanned: run.scanned + e.scanned,
          files: e.files.length ? run.files.concat(e.files) : run.files,
          storedLines: run.storedLines + e.files.reduce((n, f) => n + f.matches.length, 0)
        }
      })
    } else {
      const { kind: _kind, id: _id, ...done } = e
      set({
        run: {
          ...run,
          id: e.id,
          pending: false,
          running: false,
          done,
          finishedAt: Date.now(),
          error: e.error ?? null,
          scanned: e.scanned,
          total: e.total
        }
      })
    }
  }
}))
