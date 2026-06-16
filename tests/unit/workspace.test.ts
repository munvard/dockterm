import { describe, it, expect } from 'vitest'
import { addTab, removeTab, reorderTabs, renameTab, type WsState } from '@renderer/state/workspace'

const tab = (id: string) => ({ id, title: id, cwd: '/p' })
const base: WsState = { tabs: [tab('a'), tab('b'), tab('c')], activeId: 'b' }

describe('workspace reducers', () => {
  it('addTab appends and activates the new tab', () => {
    const s = addTab(base, tab('d'))
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(s.activeId).toBe('d')
  })

  it('removeTab of the active tab selects the right neighbor', () => {
    const s = removeTab(base, 'b')
    expect(s.tabs.map((t) => t.id)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('c')
  })

  it('removeTab of the active LAST tab selects the left neighbor', () => {
    const s = removeTab({ tabs: [tab('a'), tab('b')], activeId: 'b' }, 'b')
    expect(s.tabs.map((t) => t.id)).toEqual(['a'])
    expect(s.activeId).toBe('a')
  })

  it('removeTab of an inactive tab keeps the active selection', () => {
    const s = removeTab(base, 'a')
    expect(s.tabs.map((t) => t.id)).toEqual(['b', 'c'])
    expect(s.activeId).toBe('b')
  })

  it('removeTab never removes the last remaining tab', () => {
    const one: WsState = { tabs: [tab('a')], activeId: 'a' }
    expect(removeTab(one, 'a')).toEqual(one)
  })

  it('reorderTabs moves a tab to a new index', () => {
    const s = reorderTabs(base, 0, 2)
    expect(s.tabs.map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(s.activeId).toBe('b')
  })

  it('renameTab sets a trimmed title and ignores empty', () => {
    expect(renameTab(base, 'a', '  Build  ').tabs[0].title).toBe('Build')
    expect(renameTab(base, 'a', '   ').tabs[0].title).toBe('a')
  })
})
