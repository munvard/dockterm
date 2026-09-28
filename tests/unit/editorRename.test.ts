import { describe, it, expect } from 'vitest'
import { renameEditorTab, type EditorTab, type EditorTabsState } from '@renderer/state/editorTabs'

function makeTab(overrides: Partial<EditorTab> = {}): EditorTab {
  return {
    relPath: 'a.ts',
    name: 'a.ts',
    kind: 'text',
    content: 'hello',
    mtimeMs: 1,
    dirty: false,
    language: 'typescript',
    root: '/proj',
    ...overrides
  }
}

const state = (overrides: Partial<EditorTabsState> = {}): EditorTabsState => ({
  tabs: [makeTab()],
  activePath: 'a.ts',
  goto: null,
  ...overrides
})

describe('renameEditorTab (RU-I2)', () => {
  it('repoints relPath/name in place, keeping content and dirty state', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ dirty: true, content: 'unsaved edits' })] }),
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.tabs[0].relPath).toBe('b.ts')
    expect(next.tabs[0].name).toBe('b.ts')
    expect(next.tabs[0].dirty).toBe(true)
    expect(next.tabs[0].content).toBe('unsaved edits')
  })

  it('follows activePath when the active tab is renamed', () => {
    const next = renameEditorTab(state({ activePath: 'a.ts' }), 'a.ts', 'b.ts', 'b.ts')
    expect(next.activePath).toBe('b.ts')
  })

  it('leaves activePath alone when a different (background) tab is renamed', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab(), makeTab({ relPath: 'c.ts', name: 'c.ts' })], activePath: 'c.ts' }),
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.activePath).toBe('c.ts')
  })

  it('updates the language for a text tab based on the new name', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ relPath: 'a.js', name: 'a.js', language: 'javascript' })] }),
      'a.js',
      'a.ts',
      'a.ts'
    )
    expect(next.tabs[0].language).toBe('typescript')
  })

  it('never changes the language for a non-text (binary/image) tab', () => {
    const next = renameEditorTab(
      state({ tabs: [makeTab({ kind: 'binary', relPath: 'a.bin', name: 'a.bin', language: '' })] }),
      'a.bin',
      'b.bin',
      'b.bin'
    )
    expect(next.tabs[0].language).toBe('')
  })

  it('carries a pending goto request over to the new path', () => {
    const next = renameEditorTab(
      state({ goto: { relPath: 'a.ts', line: 42 } }),
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.goto).toEqual({ relPath: 'b.ts', line: 42 })
  })

  it('leaves an unrelated goto request untouched', () => {
    const next = renameEditorTab(
      state({ goto: { relPath: 'z.ts', line: 5 } }),
      'a.ts',
      'b.ts',
      'b.ts'
    )
    expect(next.goto).toEqual({ relPath: 'z.ts', line: 5 })
  })
})
