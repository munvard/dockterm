import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { monaco } from '../editor/monacoEnv'
import { buildMonacoTheme } from '../editor/monacoTheme'
import { DEFAULT_MONO } from '../terminal/terminalTheme'
import { useReviewStore } from '../../state/useReviewStore'
import { useAppStore } from '../../state/useAppStore'
import { useThemeStore } from '../../state/useThemeStore'

function baseName(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function DiffView() {
  const target = useReviewStore((s) => s.diffTarget)
  const closeDiff = useReviewStore((s) => s.closeDiff)
  const fontSize = useAppStore((s) => s.settings?.editor.fontSize ?? 13)
  const appTheme = useThemeStore((s) => s.theme)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'dockterm',
      automaticLayout: true,
      fontFamily: DEFAULT_MONO,
      fontSize: 13,
      readOnly: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false
    })
    editorRef.current = editor
    return () => {
      const models = editor.getModel()
      editor.dispose()
      models?.original.dispose()
      models?.modified.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    monaco.editor.defineTheme('dockterm', buildMonacoTheme(appTheme))
    monaco.editor.setTheme('dockterm')
  }, [appTheme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !target) return
    const previous = editor.getModel()
    const original = monaco.editor.createModel(target.original, target.language)
    const modified = monaco.editor.createModel(target.modified, target.language)
    editor.setModel({ original, modified })
    previous?.original.dispose()
    previous?.modified.dispose()
  }, [target])

  if (!target) return null

  return (
    <div className="editor">
      <div className="tabs">
        <div className="tab tab--active">
          <span className="tab__name">{baseName(target.relPath)} — diff</span>
          <button className="tab__close" onClick={closeDiff} aria-label="Close diff">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="editor__surface" ref={containerRef} />
    </div>
  )
}
