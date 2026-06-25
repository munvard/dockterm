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
import { HistoryRail } from '../history/HistoryRail'
import { HistoryFloating } from '../history/HistoryFloating'
import { ComposeOverlay } from '../compose/ComposeOverlay'
import { FilePreviewCard } from '../terminal/FilePreviewCard'
import { ChangesOverlay } from '../changes/ChangesOverlay'
import { useChangesStore } from '../../state/useChangesStore'
import { useComposeStore } from '../../state/useComposeStore'
import { confirmCloseLeaves } from '../terminal/closeGuard'
import { gcTerminals } from '../terminal/terminalPool'

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
  const historyOpen = useAppStore((s) => s.historyOpen)
  const histEnabled = useAppStore((s) => s.settings?.sessionHistory.enabled) ?? true
  const histSide = useAppStore((s) => s.settings?.sessionHistory.side) ?? 'right'
  const histFloating = useAppStore((s) => s.settings?.sessionHistory.floating) ?? false
  const composeEnabled = useAppStore((s) => s.settings?.terminal.composeOverlay) ?? true
  const previewsEnabled = useAppStore((s) => s.settings?.terminal.filePreviews) ?? true
  const changesEnabled = useAppStore((s) => s.settings?.terminal.changesOverlay) ?? true
  const hasTabs = useEditorStore((s) => s.tabs.length > 0)
  const diffTarget = useReviewStore((s) => s.diffTarget)
  const editorOpen = hasTabs || diffTarget != null
  // Banner reflects the FOCUSED pane's directory (via the live git status that
  // follows the active root), not the static first-opened project.
  const gitStatus = useGitStore((s) => s.status)
  const focusedNotRepo = gitStatus?.repoState === 'not-repo'

  const terminals = useWorkspaceStore((s) => s.tabs)
  const activeId = useWorkspaceStore((s) => s.activeId)
  const paneCwd = useWorkspaceStore((s) => s.paneCwd)

  const [dockW, setDockW] = useState(260)
  const [editorW, setEditorW] = useState(520)
  const [miniH, setMiniH] = useState(200)
  const [histW, setHistW] = useState(280)

  const projectPath = project?.path
  const wsProject = useRef<string | null>(null)

  const activeTab = terminals.find((t) => t.id === activeId)
  const focusedLeafId = activeTab?.focusedLeafId
  const spawnCwd = activeTab && focusedLeafId ? findLeaf(activeTab.layout, focusedLeafId)?.cwd ?? null : null
  // The dock follows the focused pane's LIVE directory (OSC 7), falling back to
  // its spawn folder when the shell hasn't reported one.
  const focusedCwd = (focusedLeafId ? paneCwd[focusedLeafId] : undefined) ?? spawnCwd

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

  // Garbage-collect pooled terminals whose pane no longer exists in any tab, so
  // closing a pane or tab tears down its shell — while a split/grid re-mount
  // (which keeps the leaf in the layout) keeps the running shell alive.
  useEffect(() => {
    const live = new Set<string>()
    for (const t of terminals) for (const leaf of allLeaves(t.layout)) live.add(leaf.id)
    gcTerminals(live)
  }, [terminals])

  // Point the dock (files/git/…) at the focused pane's project, then refresh git
  // — sequenced so the status is never read against the previous root (a race
  // that left the panel showing the first-opened project after a `cd`).
  useEffect(() => {
    if (!focusedCwd) return
    void window.dockterm.invoke('project:setActiveRoot', { path: focusedCwd }).then((res) => {
      if (!res.ok) return
      useAppStore.getState().setActiveRoot(res.value.root)
      void useGitStore.getState().refresh()
      // Keep the per-pane Changes overlay scoped to the focused terminal's repo.
      void useChangesStore.getState().refresh()
    })
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
        const tab = ws.tabs.find((tb) => tb.id === ws.activeId)
        const leafId = tab?.focusedLeafId
        if (leafId) {
          void confirmCloseLeaves([leafId]).then((proceed) => {
            if (proceed) ws.closeFocused()
          })
        } else {
          ws.closeFocused()
        }
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

  // ⌘⇧⏎ opens the Compose editor for long prompts (capture phase so it wins over
  // the focused xterm). ⌘⏎ / Esc are handled inside the overlay.
  useEffect(() => {
    if (!composeEnabled) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        useComposeStore.getState().openCompose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [composeEnabled])

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
  // Docked side-panel checkpoints; the floating variant is rendered separately.
  const showHist = historyOpen && histEnabled && !histFloating
  const histRail = (
    <div className="hist-wrap" style={{ width: histW }} key="hist">
      <HistoryRail cwd={focusedCwd} leafId={focusedLeafId ?? null} />
    </div>
  )
  const histDivider = (
    <Divider
      key="dv-hist"
      direction="v"
      onResize={(d) => setHistW((w) => clamp(w + (histSide === 'left' ? d : -d), 200, 560))}
    />
  )
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
      {focusedNotRepo && (
        <div className="banner">
          <span>This folder isn&apos;t a Git repository yet.</span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => void initGit().then(() => useGitStore.getState().refresh())}
          >
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
          {showHist && histSide === 'left' && histRail}
          {showHist && histSide === 'left' && histDivider}
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
          {showHist && histSide === 'right' && histDivider}
          {showHist && histSide === 'right' && histRail}
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
                <MiniTerminal
                  key={`mini-${project.path}`}
                  id={`mini:${project.path}`}
                  kind="mini"
                  cwd={project.path}
                  {...termProps}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {composeEnabled && <ComposeOverlay />}
      {previewsEnabled && <FilePreviewCard />}
      {changesEnabled && <ChangesOverlay />}
      {historyOpen && histEnabled && histFloating && (
        <HistoryFloating cwd={focusedCwd} leafId={focusedLeafId ?? null} />
      )}
    </div>
  )
}
