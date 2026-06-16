import { useEffect, useRef } from 'react'
import { monaco } from './monacoEnv'
import { buildMonacoTheme } from './monacoTheme'
import { DEFAULT_MONO } from '../terminal/terminalTheme'
import { EditorTabs } from './EditorTabs'
import { useEditorStore } from '../../state/useEditorStore'
import { useAppStore } from '../../state/useAppStore'
import { useThemeStore } from '../../state/useThemeStore'

function modelUri(relPath: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://dockterm/${relPath}`)
}

export function EditorPane() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const activePath = useEditorStore((s) => s.activePath)
  const tabs = useEditorStore((s) => s.tabs)
  const fontSize = useAppStore((s) => s.settings?.editor.fontSize ?? 13)
  const appTheme = useThemeStore((s) => s.theme)

  useEffect(() => {
    if (!containerRef.current) return
    const editor = monaco.editor.create(containerRef.current, {
      theme: 'dockterm',
      automaticLayout: true,
      fontFamily: DEFAULT_MONO,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderWhitespace: 'selection',
      tabSize: 2,
      wordBasedSuggestions: 'off',
      quickSuggestions: false,
      padding: { top: 8 }
    })
    editorRef.current = editor

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useEditorStore.getState().activePath
      const model = editor.getModel()
      if (path && model) void useEditorStore.getState().save(path, model.getValue())
    })

    const sub = editor.onDidChangeModelContent(() => {
      const path = useEditorStore.getState().activePath
      if (path) useEditorStore.getState().markDirty(path, true)
    })

    return () => {
      sub.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  // Re-skin Monaco when the app theme changes.
  useEffect(() => {
    monaco.editor.defineTheme('dockterm', buildMonacoTheme(appTheme))
    monaco.editor.setTheme('dockterm')
  }, [appTheme])

  // Swap the active model.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!activePath) {
      editor.setModel(null)
      return
    }
    const tab = tabs.find((t) => t.relPath === activePath)
    if (!tab) {
      editor.setModel(null)
      return
    }
    const uri = modelUri(activePath)
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(tab.content, tab.language, uri)
    if (editor.getModel() !== model) editor.setModel(model)
  }, [activePath, tabs])

  // Dispose models for closed tabs.
  useEffect(() => {
    const openUris = new Set(tabs.map((t) => modelUri(t.relPath).toString()))
    for (const model of monaco.editor.getModels()) {
      if (model.uri.scheme === 'inmemory' && !openUris.has(model.uri.toString())) {
        model.dispose()
      }
    }
  }, [tabs])

  return (
    <div className="editor">
      <EditorTabs />
      <div className="editor__surface" ref={containerRef} />
    </div>
  )
}
