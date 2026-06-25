import { useEffect, useRef } from 'react'
import { monaco } from '../editor/monacoEnv'
import { buildMonacoTheme } from '../editor/monacoTheme'
import { DEFAULT_MONO } from '../terminal/terminalTheme'
import { languageForFile } from '../editor/language'
import { useThemeStore } from '../../state/useThemeStore'
import type { DiffContent } from '@shared/types'

/**
 * An inline, read-only diff for one changed file. Lazily imported so Monaco
 * stays out of the startup bundle until a row is actually expanded.
 *
 * `full=false` (diff-only) collapses unchanged regions via Monaco's
 * hideUnchangedRegions — so a 500-line file shows just its hunks + context.
 */
export function ChangesDiff({ diff, full }: { diff: DiffContent; full: boolean }): React.ReactElement {
  const appTheme = useThemeStore((s) => s.theme)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    monaco.editor.defineTheme('dockterm', buildMonacoTheme(appTheme))
    const editor = monaco.editor.createDiffEditor(containerRef.current, {
      theme: 'dockterm',
      automaticLayout: true,
      fontFamily: DEFAULT_MONO,
      fontSize: 12,
      readOnly: true,
      renderSideBySide: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      hideUnchangedRegions: { enabled: !full }
    })
    editorRef.current = editor
    return () => {
      const m = editor.getModel()
      editor.dispose()
      m?.original.dispose()
      m?.modified.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap models whenever the file (or its fresh diff) changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const lang = languageForFile(diff.relPath)
    const prev = editor.getModel()
    const original = monaco.editor.createModel(diff.original, lang)
    const modified = monaco.editor.createModel(diff.modified, lang)
    editor.setModel({ original, modified })
    prev?.original.dispose()
    prev?.modified.dispose()
  }, [diff])

  useEffect(() => {
    editorRef.current?.updateOptions({ hideUnchangedRegions: { enabled: !full } })
  }, [full])

  useEffect(() => {
    monaco.editor.defineTheme('dockterm', buildMonacoTheme(appTheme))
    monaco.editor.setTheme('dockterm')
  }, [appTheme])

  return <div className="changes-diff" ref={containerRef} />
}
