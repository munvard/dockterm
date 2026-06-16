import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { GitBranchPlus } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useGitStore } from '../../state/useGitStore'
import { useReviewStore } from '../../state/useReviewStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { allLeaves, findLeaf } from '../../state/layout'
import { TopBar } from './TopBar'
import { Dock } from './Dock'
import { Divider } from './Divider'
import { TabStrip } from '../terminal/TabStrip'
import { PaneTree } from '../terminal/PaneTree'
import { MiniTerminal } from '../terminal/MiniTerminal'

// Lazily loaded so Monaco (the editor) isn't part of the startup bundle.
const EditorPane = lazy(() => import('../editor/EditorPane').then((m) => ({ default: m.EditorPane })))
const DiffView = lazy(() => import('../review/DiffView').then((m) => ({ default: m.DiffView })))

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function Shell() {
  const project = useAppStore((s) => s.project)
  const settings = useAppStore((s) => s.settings)
  const initGit = useAppStore((s) => s.initGitRepo)
  const openPanel = useAppStore((s) => s.openPanel)
  const miniTermOpen = useAppStore((s) => s.miniTermOpen)
  const hasTabs = useEditorStore((s) => s.tabs.length > 0)
  const diffTarget = useReviewStore((s) => s.diffTarget)
  const editorOpen = hasTabs || diffTarget != null

  const terminals = useWorkspaceStore((s) => s.tabs)
  const activeId = useWorkspaceStore((s) => s.activeId)

  const [dockW, setDockW] = useState(260)
  const [editorW, setEditorW] = useState(520)
  const [miniH, setMiniH] = useState(200)

  const projectPath = project?.path
  const wsProject = useRef<string | null>(null)

  const activeTab = terminals.find((t) => t.id === activeId)
  const focusedCwd = activeTab ? findLeaf(activeTab.layout, activeTab.focusedLeafId)?.cwd ?? null : null

  useEffect(() => {
    if (!projectPath) return
    const ws = useWorkspaceStore.getState()
    if (wsProject.current === null) {
      const app = useAppStore.getState()
      ws.init(projectPath, app.settings?.workspace ?? null, app.isPrimary)
    } else if (wsProject.current !== projectPath) {
      ws.resetForProject(projectPath)
    }
    wsProject.current = projectPath
  }, [projectPath])

  // Point the dock (files/git/…) at the focused pane's project, and refresh.
  useEffect(() => {
    if (!focusedCwd) return
    void window.dockterm.invoke('project:setActiveRoot', { path: focusedCwd }).then((res) => {
      if (res.ok) useAppStore.getState().setActiveRoot(res.value.root)
    })
    void useGitStore.getState().refresh()
  }, [focusedCwd])

  // Terminal shortcuts (capture phase so they win over the focused xterm).
  useEffect(() => {
    if (!projectPath) return
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const ws = useWorkspaceStore.getState()
      if (e.key === 't') {
        e.preventDefault()
        e.stopPropagation()
        ws.open(projectPath)
      } else if (e.key === 'w') {
        e.preventDefault()
        e.stopPropagation()
        ws.closeFocused()
      } else if (e.key === 'd') {
        e.preventDefault()
        e.stopPropagation()
        ws.splitFocused('row')
      } else if (e.key === 'n') {
        e.preventDefault()
        e.stopPropagation()
        void window.dockterm.invoke('window:new', undefined)
      } else if (e.key >= '1' && e.key <= '9') {
        const tab = ws.tabs[Number(e.key) - 1]
        if (tab) {
          e.preventDefault()
          e.stopPropagation()
          ws.setActive(tab.id)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [projectPath])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.dockterm.on('fs:watch', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void useGitStore.getState().refresh(), 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [])

  if (!project) return null
  const t = settings?.terminal
  const termProps = {
    fontFamily: t?.fontFamily ?? undefined,
    fontSize: t?.fontSize,
    cursorStyle: t?.cursorStyle,
    cursorBlink: t?.cursorBlink,
    scrollback: t?.scrollback,
    renderer: t?.renderer
  }

  return (
    <div className="app">
      <TopBar />
      {!project.isGitRepo && (
        <div className="banner">
          <span>This folder isn&apos;t a Git repository yet.</span>
          <button className="btn btn--ghost btn--sm" onClick={() => void initGit()}>
            <GitBranchPlus size={13} /> Initialize Git
          </button>
        </div>
      )}
      <div className="app__body">
        <div className="hrow">
          {openPanel && (
            <div className="dock-wrap" style={{ width: dockW }} key="dock">
              <Dock />
            </div>
          )}
          {openPanel && (
            <Divider
              key="dv-dock"
              direction="v"
              onResize={(d) => setDockW((w) => clamp(w + d, 170, 560))}
            />
          )}
          <div className="term-wrap" key="term">
            <TabStrip />
            <div className="term-stack">
              {terminals.map((tab) => (
                <div
                  key={tab.id}
                  className="term-tabhost"
                  style={{ display: tab.id === activeId ? 'block' : 'none' }}
                >
                  <PaneTree
                    node={tab.layout}
                    tabId={tab.id}
                    focusedLeafId={tab.focusedLeafId}
                    tabActive={tab.id === activeId}
                    canClose={allLeaves(tab.layout).length > 1 || terminals.length > 1}
                  />
                </div>
              ))}
            </div>
          </div>
          {editorOpen && (
            <Divider
              key="dv-editor"
              direction="v"
              onResize={(d) => setEditorW((w) => clamp(w - d, 280, 1100))}
            />
          )}
          {editorOpen && (
            <div className="editor-wrap" style={{ width: editorW }} key="editor">
              <Suspense fallback={<div className="editor" />}>
                {diffTarget ? <DiffView /> : <EditorPane />}
              </Suspense>
            </div>
          )}
        </div>
        {miniTermOpen && (
          <Divider
            key="dv-mini"
            direction="h"
            onResize={(d) => setMiniH((h) => clamp(h - d, 100, 600))}
          />
        )}
        {miniTermOpen && (
          <div className="mini-wrap" style={{ height: miniH }} key="mini">
            <div className="minit">
              <div className="minit__bar">mini terminal</div>
              <div className="minit__body">
                <MiniTerminal key={`mini-${project.path}`} kind="mini" cwd={project.path} {...termProps} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
