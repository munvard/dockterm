import { useEffect, useRef, useState } from 'react'
import { File, AlertTriangle } from 'lucide-react'
import { monaco } from './monacoEnv'
import { buildMonacoTheme } from './monacoTheme'
import { DEFAULT_MONO } from '../terminal/terminalTheme'
import { EditorTabs } from './EditorTabs'
import { useEditorStore } from '../../state/useEditorStore'
import type { EditorTab } from '../../state/editorTabs'
import { useAppStore } from '../../state/useAppStore'
import { useThemeStore } from '../../state/useThemeStore'

/** One Monaco model per tab: the root is part of the URI, so two projects with
 * the same relative path never share (or overwrite) a model. */
function modelUri(tab: Pick<EditorTab, 'root' | 'relPath'>): monaco.Uri {
  return monaco.Uri.from({
    scheme: 'inmemory',
    authority: 'dockterm',
    path: `/${encodeURIComponent(tab.root)}/${tab.relPath}`
  })
}

function ImageViewer({ dataUrl }: { dataUrl: string }) {
  const [zoom, setZoom] = useState(false)
  return (
    <div
      className={`imgview${zoom ? ' imgview--zoom' : ''}`}
      onClick={() => setZoom((z) => !z)}
      title={zoom ? 'Click to fit' : 'Click to zoom'}
    >
      <img src={dataUrl} alt="" draggable={false} />
    </div>
  )
}

function formatSize(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`
}

function BinaryCard({ relPath, name, size }: { relPath: string; name: string; size: number }) {
  return (
    <div className="bincard">
      <File size={44} className="bincard__icon" />
      <div className="bincard__name">{name}</div>
      <div className="bincard__meta">{formatSize(size)} · binary file</div>
      <div className="bincard__actions">
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void window.dockterm.invoke('fs:reveal', { relPath })}
        >
          Reveal in folder
        </button>
        <button
          className="btn btn--ghost btn--sm"
          onClick={() => void window.dockterm.invoke('fs:openPath', { relPath })}
        >
          Open externally
        </button>
      </div>
    </div>
  )
}

export function EditorPane() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Guards the onDidChangeModelContent listener while WE push a programmatic
  // update (a silent disk reload) into the model, so it isn't mistaken for a
  // user keystroke and re-marked dirty.
  const suppressDirtyRef = useRef(false)
  const seenDiskRevisions = useRef<Record<string, number>>({})
  const activeId = useEditorStore((s) => s.activeId)
  const tabs = useEditorStore((s) => s.tabs)
  const goto = useEditorStore((s) => s.goto)
  const fontSize = useAppStore((s) => s.settings?.editor.fontSize ?? 13)
  const appTheme = useThemeStore((s) => s.theme)

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  const activeKind = activeTab?.kind ?? null

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
      const id = useEditorStore.getState().activeId
      const model = editor.getModel()
      if (id && model) void useEditorStore.getState().save(id, model.getValue())
    })

    const sub = editor.onDidChangeModelContent(() => {
      if (suppressDirtyRef.current) return
      const id = useEditorStore.getState().activeId
      if (id) useEditorStore.getState().markDirty(id, true)
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

  // Swap the active model (text tabs only).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const tab = tabs.find((t) => t.id === activeId)
    if (!activeId || !tab || tab.kind !== 'text') {
      editor.setModel(null)
      return
    }
    const uri = modelUri(tab)
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(tab.content, tab.language, uri)
    if (editor.getModel() !== model) editor.setModel(model)
  }, [activeId, tabs])

  // Silent disk reload (RU-I12): a tab's content was just refreshed from disk
  // (syncFromDisk or the explicit "Reload" banner action) — push it into an
  // already-open Monaco model. Keyed off diskRevision, never plain content
  // changes, so this can't fire while the user is simply typing (typing never
  // touches diskRevision — content is only synced to the store on save()).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    for (const tab of tabs) {
      if (tab.kind !== 'text') continue
      const rev = tab.diskRevision ?? 0
      const seen = seenDiskRevisions.current[tab.id] ?? 0
      if (rev === seen) continue
      seenDiskRevisions.current[tab.id] = rev
      const model = monaco.editor.getModel(modelUri(tab))
      if (!model) continue // not open in Monaco yet — it'll read tab.content when activated
      const isActive = tab.id === activeId
      const pos = isActive ? editor.getPosition() : null
      suppressDirtyRef.current = true
      model.setValue(tab.content)
      suppressDirtyRef.current = false
      if (isActive && pos) editor.setPosition(pos)
    }
  }, [tabs, activeId])

  // Listen for external file changes and pull them into any open tab —
  // silently when it has no unsaved edits, or flagged (staleOnDisk) when it
  // does, so a file changed outside DockTerm doesn't just sit stale forever.
  useEffect(() => {
    return window.dockterm.on('fs:watch', (batch) => {
      // The watcher follows the window's active root, so a batch only speaks
      // for tabs of that root: another project's same-named file is untouched.
      const root = useAppStore.getState().activeRoot
      const open = new Map(
        useEditorStore
          .getState()
          .tabs.filter((t) => t.root === root)
          .map((t) => [t.relPath, t.id])
      )
      for (const ev of batch.events) {
        if (ev.type !== 'change' && ev.type !== 'unlink') continue
        const id = open.get(ev.relPath)
        if (id) void useEditorStore.getState().syncFromDisk(id)
      }
    })
  }, [])

  // Jump to a line when a clicked path carried one (e.g. server.ts:42).
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !goto || goto.id !== activeId) return
    const model = editor.getModel()
    if (!model) return
    const line = Math.min(Math.max(1, goto.line), model.getLineCount())
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
    editor.focus()
    useEditorStore.getState().clearGoto()
  }, [goto, activeId, tabs])

  // Dispose models for closed tabs.
  useEffect(() => {
    const openUris = new Set(
      tabs.filter((t) => t.kind === 'text').map((t) => modelUri(t).toString())
    )
    for (const model of monaco.editor.getModels()) {
      if (model.uri.scheme === 'inmemory' && !openUris.has(model.uri.toString())) {
        model.dispose()
      }
    }
  }, [tabs])

  return (
    <div className="editor">
      <EditorTabs />
      {activeKind === 'text' && activeTab?.staleOnDisk && (
        <div className="editor-stale">
          <AlertTriangle size={13} />
          <span>This file changed on disk since you opened it.</span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void useEditorStore.getState().reloadFromDisk(activeTab.id)}
          >
            Reload (discard your edits)
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => useEditorStore.getState().dismissStale(activeTab.id)}
          >
            Dismiss
          </button>
        </div>
      )}
      <div
        className="editor__surface"
        ref={containerRef}
        style={{ display: activeKind === 'text' ? 'block' : 'none' }}
      />
      {activeKind === 'image' && activeTab?.dataUrl && <ImageViewer dataUrl={activeTab.dataUrl} />}
      {activeKind === 'binary' && activeTab && (
        <BinaryCard relPath={activeTab.relPath} name={activeTab.name} size={activeTab.size ?? 0} />
      )}
    </div>
  )
}
