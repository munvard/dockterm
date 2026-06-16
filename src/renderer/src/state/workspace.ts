/** Pure tab-workspace reducers (no React, fully unit-tested). A "tab" is one
 * terminal in Milestone B; Milestone C generalizes a tab to a pane tree. */

export interface WsTab {
  id: string
  title: string
  cwd: string
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
