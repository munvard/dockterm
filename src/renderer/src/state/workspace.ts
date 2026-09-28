/** Pure tab-list reducers (no React, fully unit-tested). Each tab owns a tiling
 * `layout` of terminals (see layout.ts); these reducers only manage the tab list. */
import type { LayoutNode } from './layout'

/** Last path segment of a filesystem path, on either separator style ('' for a
 * root path with no segments, e.g. '/' or 'C:\'). Used wherever the UI needs a
 * short, human name for a project/pane folder — the TopBar's project name and
 * the window's document.title both derive from this, not from a static
 * first-opened project, so they follow the FOCUSED pane's actual root. */
export function basenameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? ''
}

export interface WsTab {
  id: string
  title: string
  layout: LayoutNode
  focusedLeafId: string
}

export interface WsState {
  tabs: WsTab[]
  activeId: string
}

export function addTab(s: WsState, tab: WsTab): WsState {
  return { tabs: [...s.tabs, tab], activeId: tab.id }
}

export function removeTab(s: WsState, id: string): WsState {
  if (s.tabs.length <= 1) return s
  const idx = s.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return s
  const tabs = s.tabs.filter((t) => t.id !== id)
  let activeId = s.activeId
  if (s.activeId === id) {
    // prefer the right neighbor (which shifts into idx), else the new last
    activeId = tabs[Math.min(idx, tabs.length - 1)].id
  }
  return { tabs, activeId }
}

export function reorderTabs(s: WsState, from: number, to: number): WsState {
  if (from === to || from < 0 || to < 0 || from >= s.tabs.length || to >= s.tabs.length) return s
  const tabs = [...s.tabs]
  const [moved] = tabs.splice(from, 1)
  tabs.splice(to, 0, moved)
  return { ...s, tabs }
}

export function renameTab(s: WsState, id: string, title: string): WsState {
  const trimmed = title.trim()
  return {
    ...s,
    tabs: s.tabs.map((t) => (t.id === id && trimmed ? { ...t, title: trimmed } : t))
  }
}
