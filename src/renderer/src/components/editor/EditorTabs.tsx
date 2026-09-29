import { X } from 'lucide-react'
import { useEditorStore } from '../../state/useEditorStore'

export function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs)
  const activeId = useEditorStore((s) => s.activeId)
  const setActive = useEditorStore((s) => s.setActive)
  const requestClose = useEditorStore((s) => s.requestClose)

  if (tabs.length === 0) return null

  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeId ? ' tab--active' : ''}`}
          onMouseDown={() => setActive(tab.id)}
          title={tab.relPath}
          role="tab"
          aria-selected={tab.id === activeId}
        >
          <span className="tab__name">{tab.name}</span>
          <button
            className="tab__close"
            onMouseDown={(e) => {
              e.stopPropagation()
              void requestClose(tab.id)
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
