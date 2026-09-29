import { X } from 'lucide-react'
import { useEditorStore } from '../../state/useEditorStore'
import { useDialogStore } from '../../state/useDialogStore'

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const setActive = useEditorStore((s) => s.setActive)
  const close = useEditorStore((s) => s.close)

  if (tabs.length === 0) return null

  const closeTab = async (relPath: string, name: string, dirty: boolean): Promise<void> => {
    if (dirty) {
      const discard = await useDialogStore.getState().confirm({
        title: 'Unsaved changes',
        message: `"${name}" has unsaved changes. Close it and discard them?`,
        confirmLabel: 'Discard changes',
        danger: true
      })
      if (!discard) return
    }
    close(relPath)
  }

  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.relPath}
          className={`tab${tab.relPath === activePath ? ' tab--active' : ''}`}
          onMouseDown={() => setActive(tab.relPath)}
          title={tab.relPath}
          role="tab"
          aria-selected={tab.relPath === activePath}
        >
          <span className="tab__name">{tab.name}</span>
          <button
            className="tab__close"
            onMouseDown={(e) => {
              e.stopPropagation()
              void closeTab(tab.relPath, tab.name, tab.dirty)
            }}
            aria-label={`Close ${tab.name}`}
          >
            {tab.dirty ? <span className="tab__dot" /> : <X size={12} />}
          </button>
        </div>
      ))}
    </div>
  )
}
