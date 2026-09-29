import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useEditorStore } from '@renderer/state/useEditorStore'
import { useDialogStore } from '@renderer/state/useDialogStore'
import { tabKey, type EditorTab } from '@renderer/state/editorTabs'

function tab(relPath: string, dirty: boolean): EditorTab {
  return {
    id: tabKey('/p', relPath),
    relPath,
    name: relPath,
    kind: 'text',
    content: '',
    mtimeMs: 1,
    dirty,
    language: 'typescript',
    root: '/p'
  }
}

describe('requestClose (I5: the keyboard and the button share one dirty guard)', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [tab('a.ts', true), tab('b.ts', false)], activeId: tabKey('/p', 'a.ts'), goto: null })
  })

  it('asks before closing a dirty tab and keeps it when the user cancels', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    useDialogStore.setState({ confirm })
    const closed = await useEditorStore.getState().requestClose(tabKey('/p', 'a.ts'))
    expect(closed).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(useEditorStore.getState().tabs.map((t) => t.relPath)).toEqual(['a.ts', 'b.ts'])
  })

  it('closes a dirty tab once the user confirms discarding', async () => {
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true) })
    const closed = await useEditorStore.getState().requestClose(tabKey('/p', 'a.ts'))
    expect(closed).toBe(true)
    expect(useEditorStore.getState().tabs.map((t) => t.relPath)).toEqual(['b.ts'])
    expect(useEditorStore.getState().activeId).toBe(tabKey('/p', 'b.ts'))
  })

  it('closes a clean tab without asking', async () => {
    const confirm = vi.fn()
    useDialogStore.setState({ confirm })
    expect(await useEditorStore.getState().requestClose(tabKey('/p', 'b.ts'))).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
  })
})
