import { describe, it, expect, vi } from 'vitest'
import {
  renameEditorTab,
  closeEditorTab,
  mayCloseTab,
  tabKey,
  type EditorTab,
  type EditorTabsState
} from '@renderer/state/editorTabs'

const ROOT = '/proj'

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  const relPath = overrides.relPath ?? 'a.ts'
  const root = overrides.root ?? ROOT
  return {
    id: tabKey(root, relPath),
    relPath,
    name: relPath,
    kind: 'text',
    content: 'hello',
    mtimeMs: 1,
    dirty: false,
    language: 'typescript',
    root,
    ...overrides
  }
}

const state = (overrides: Partial<EditorTabsState> = {}): EditorTabsState => ({
  tabs: [makeTab()],
  activeId: tabKey(ROOT, 'a.ts'),
  goto: null,
  ...overrides
})

describe('renameEditorTab (RU-I2)', () => {
  it('repoints relPath/name/id in place, keeping content and dirty state', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ dirty: true, content: 'unsaved edits' })] }),
      ROOT,
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.tabs[0].relPath).toBe('b.ts')
    expect(next.tabs[0].id).toBe(tabKey(ROOT, 'b.ts'))
    expect(next.tabs[0].name).toBe('b.ts')
    expect(next.tabs[0].dirty).toBe(true)
    expect(next.tabs[0].content).toBe('unsaved edits')
  })

  it('follows activeId when the active tab is renamed', () => {
    const next = renameEditorTab(state(), ROOT, 'a.ts', 'b.ts', 'b.ts')
    expect(next.activeId).toBe(tabKey(ROOT, 'b.ts'))
  })

  it('leaves activeId alone when a different (background) tab is renamed', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab(), makeTab({ relPath: 'c.ts' })], activeId: tabKey(ROOT, 'c.ts') }),
      ROOT,
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.activeId).toBe(tabKey(ROOT, 'c.ts'))
  })

  it('updates the language for a text tab based on the new name', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ relPath: 'a.js', language: 'javascript' })] }),
      ROOT,
      'a.js',
      'a.ts',
      'a.ts'
    )
    expect(next.tabs[0].language).toBe('typescript')
  })

  it('never changes the language for a non-text (binary/image) tab', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ kind: 'binary', relPath: 'a.bin', language: '' })] }),
      ROOT,
      'a.bin',
      'b.bin',
      'b.bin'
    )
    expect(next.tabs[0].language).toBe('')
  })

  it('carries a pending goto request over to the new path', () => {
    const next = renameEditorTab(
      state({ goto: { id: tabKey(ROOT, 'a.ts'), line: 42 } }),
      ROOT,
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.goto).toEqual({ id: tabKey(ROOT, 'b.ts'), line: 42 })
  })

  it('leaves an unrelated goto request untouched', () => {
    const next = renameEditorTab(
      state({ goto: { id: tabKey(ROOT, 'z.ts'), line: 5 } }),
      ROOT,
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.goto).toEqual({ id: tabKey(ROOT, 'z.ts'), line: 5 })
  })

  it('does not rename a same-named file that belongs to another project (I4)', () => {
    const other = makeTab({ root: '/other', relPath: 'a.ts', content: 'other project' })
    const next = renameEditorTab(state({ tabs: [makeTab(), other] }), ROOT, 'a.ts', 'b.ts', 'b.ts')
    expect(next.tabs.map((t) => t.id)).toEqual([tabKey(ROOT, 'b.ts'), tabKey('/other', 'a.ts')])
    expect(next.tabs[1].relPath).toBe('a.ts')
  })
})

describe('tab identity across roots (I4)', () => {
  it('gives the same relPath in two projects two different ids', () => {
    expect(tabKey('/a', 'src/index.ts')).not.toBe(tabKey('/b', 'src/index.ts'))
  })

  it('closing one project\'s tab keeps the other project\'s same-named tab', () => {
    const a = makeTab({ root: '/a', relPath: 'src/index.ts' })
    const b = makeTab({ root: '/b', relPath: 'src/index.ts' })
    const next = closeEditorTab({ tabs: [a, b], activeId: a.id, goto: null }, a.id)
    expect(next.tabs).toEqual([b])
    expect(next.activeId).toBe(b.id)
  })
})

describe('mayCloseTab (I5: the keyboard and the button share one dirty guard)', () => {
  it('asks before closing a dirty tab and refuses when the user cancels', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    expect(await mayCloseTab(makeTab({ dirty: true }), confirm)).toBe(false)
    expect(confirm).toHaveBeenCalledWith('a.ts')
  })

  it('closes a dirty tab once the user agrees to discard', async () => {
    expect(await mayCloseTab(makeTab({ dirty: true }), vi.fn().mockResolvedValue(true))).toBe(true)
  })

  it('closes a clean tab without asking, and does nothing for a missing tab', async () => {
    const confirm = vi.fn()
    expect(await mayCloseTab(makeTab(), confirm)).toBe(true)
    expect(await mayCloseTab(undefined, confirm)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })
})
