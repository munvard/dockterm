import { Fragment, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  GripVertical,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Milestone,
  X,
  PenLine,
  GitCompareArrows,
  MessagesSquare,
  SquareTerminal
} from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useMunuStore } from '../../state/useMunuStore'
import { useEditorStore } from '../../state/useEditorStore'
import { useFilePreviewStore } from '../../state/useFilePreviewStore'
import { useComposeStore } from '../../state/useComposeStore'
import { useChangesStore } from '../../state/useChangesStore'
import { useToastStore } from '../../state/useToastStore'
import { paneWriters } from '../../state/paneWriters'
import { confirmCloseLeaves } from './closeGuard'
import { toRelProjectPath } from './projectPath'
import type { LayoutNode, LeafNode } from '../../state/layout'
import { TerminalView } from './TerminalView'
import { focusPaneTerminal } from './terminalPool'
import { quotePath } from './terminalSelection'
import { PaneChat } from '../chat/PaneChat'

function sameSizes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5)
}

/** Leaving chat mode must hand the keyboard back: the terminal host is still
 * `display:none` this tick, and TerminalView's focus effect keys off `active`
 * (unchanged), so focus after the next paint. */
export function refocusIfTerminal(leafId: string): void {
  requestAnimationFrame(() => {
    const fallback = useAppStore.getState().settings?.chat.defaultMode ?? 'terminal'
    if ((useWorkspaceStore.getState().paneView[leafId] ?? fallback) !== 'chat') {
      focusPaneTerminal(leafId)
    }
  })
}

/** Quote a dropped path for the current OS (see terminalSelection.quotePath). */
function quoteForThisPlatform(p: string): string {
  return quotePath(p, document.documentElement.dataset.platform ?? '')
}

function TerminalPane({
  leaf,
  tabId,
  focused,
  tabActive,
  canClose,
  hideBar
}: {
  leaf: LeafNode
  tabId: string
  focused: boolean
  /** Whether this pane's tab is the active one (chat mode backs off when not). */
  tabActive: boolean
  canClose: boolean
  /** Single-pane tab: skip the per-pane title bar (the tab already names it). */
  hideBar: boolean
}) {
  const t = useAppStore((s) => s.settings?.terminal)
  const histEnabled = useAppStore((s) => s.settings?.sessionHistory.enabled) ?? true
  const historyOpen = useAppStore((s) => s.historyOpen)
  const toggleHistory = useAppStore((s) => s.toggleHistory)
  const focusPane = useWorkspaceStore((s) => s.focusPane)
  const split = useWorkspaceStore((s) => s.splitFocused)
  const closeFocused = useWorkspaceStore((s) => s.closeFocused)
  const markActivity = useWorkspaceStore((s) => s.markActivity)
  const swapLeaves = useWorkspaceStore((s) => s.swapLeaves)
  const paneTitle = useWorkspaceStore((s) => s.paneTitle[leaf.id])
  const defaultMode = useAppStore((s) => s.settings?.chat.defaultMode) ?? 'terminal'
  const paneMode = useWorkspaceStore((s) => s.paneView[leaf.id]) ?? defaultMode
  const chatOn = paneMode === 'chat'
  const paneCwdValue = useWorkspaceStore((s) => s.paneCwd[leaf.id]) ?? leaf.cwd
  const pasteRef = useRef<(text: string) => void>(() => {})
  const [dragOver, setDragOver] = useState(false)
  const [reorderOver, setReorderOver] = useState(false)

  // Note: the pane's Claude-state + writer registrations are dropped by the
  // terminal pool when the terminal is truly disposed (pane closed / GC'd), not
  // on every React unmount — so a split/grid re-mount keeps the running shell.

  const act = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    focusPane(tabId, leaf.id)
    fn()
  }

  const clearDrag = (): void => {
    setDragOver(false)
    setReorderOver(false)
  }

  const onDragOver = (e: DragEvent) => {
    const dt = e.dataTransfer
    const isPane = dt.types.includes('application/x-dockterm-pane')
    const hasFile =
      dt.types.includes('application/x-dockterm') ||
      dt.types.includes('Files') ||
      dt.types.includes('text/plain')
    if (!isPane && !hasFile) return
    e.preventDefault()
    dt.dropEffect = isPane ? 'move' : 'copy'
    if (isPane) {
      if (!reorderOver) setReorderOver(true)
    } else if (!dragOver) {
      setDragOver(true)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    clearDrag()

    // Another pane was dropped here → swap their positions (drag-to-reorder).
    // Each terminal keeps its running shell; only the grid slots change.
    const paneData = e.dataTransfer.getData('application/x-dockterm-pane')
    if (paneData) {
      try {
        const src = JSON.parse(paneData) as { leafId: string; tabId: string }
        if (src.leafId && src.leafId !== leaf.id && src.tabId === tabId) {
          swapLeaves(tabId, src.leafId, leaf.id)
        }
      } catch {
        // ignore malformed payload
      }
      return
    }

    focusPane(tabId, leaf.id)

    // From the file tree (or anything emitting our payload). Both files AND
    // folders are typed (quoted) at the prompt — drag a folder to print its path.
    const internal = e.dataTransfer.getData('application/x-dockterm')
    if (internal) {
      try {
        const { path } = JSON.parse(internal) as { path: string; type: 'file' | 'dir' }
        if (path) pasteRef.current(quoteForThisPlatform(path))
      } catch {
        // ignore malformed payload
      }
      return
    }

    // From Finder / Explorer — one or more real files.
    const files = Array.from(e.dataTransfer.files)
    if (files.length) {
      const paths = files
        .map((f) => window.dockterm.pathForFile(f))
        .filter(Boolean)
        .map((p) => quoteForThisPlatform(p))
      if (paths.length) pasteRef.current(paths.join(' '))
      return
    }

    // Last resort: plain-text path payload.
    const text = e.dataTransfer.getData('text/plain')
    if (text) pasteRef.current(quoteForThisPlatform(text))
  }

  // Every split (non-root) pane shows its own label: the live terminal title
  // (Claude Code / shell, via OSC 0/2) when present, else its folder name.
  const label = paneTitle ?? leaf.title
  const showTitle = !hideBar && !!label
  return (
    <div
      className={`pane${focused && !hideBar ? ' pane--focused' : ''}${dragOver ? ' pane--drop' : ''}${reorderOver ? ' pane--reorder' : ''}`}
      onMouseDown={() => focusPane(tabId, leaf.id)}
      onDragOver={onDragOver}
      onDragLeave={clearDrag}
      onDrop={onDrop}
    >
      {showTitle && (
        <div className="pane__bar">
          <span className="pane__title">{label}</span>
        </div>
      )}
      {/* Always-visible pane controls: split right/down (and close). A grip lets
          you drag a pane onto another to swap their positions (reorder a grid).
          Floating so even a single, bar-less pane keeps quick split access. */}
      <div className="pane__controls">
        {!hideBar && (
          <button
            className="pane__grip"
            title="Drag to reorder"
            aria-label="Drag to reorder pane"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                'application/x-dockterm-pane',
                JSON.stringify({ leafId: leaf.id, tabId })
              )
              e.dataTransfer.effectAllowed = 'move'
              focusPane(tabId, leaf.id)
            }}
            onDragEnd={clearDrag}
          >
            <GripVertical size={14} />
          </button>
        )}
        {histEnabled && (
          <button
            className={historyOpen ? 'pane__active' : undefined}
            title="Checkpoints (your prompts)"
            aria-label="Toggle checkpoints"
            onMouseDown={act(() => toggleHistory())}
          >
            <Milestone size={14} />
          </button>
        )}
        {(t?.changesOverlay ?? true) && (
          <button
            title="Changes in this terminal's project"
            aria-label="Show changes for this terminal"
            onMouseDown={act(() => {
              focusPane(tabId, leaf.id)
              useChangesStore.getState().setOpen(true)
            })}
          >
            <GitCompareArrows size={14} />
          </button>
        )}
        <button
          title={chatOn ? 'Show the terminal (⌘R)' : 'Chat mode — comfortable reading (⌘R)'}
          aria-label="Toggle chat mode"
          className={chatOn ? 'pane__active' : undefined}
          onMouseDown={act(() => {
            focusPane(tabId, leaf.id)
            useWorkspaceStore.getState().togglePaneView(leaf.id, defaultMode)
            refocusIfTerminal(leaf.id)
          })}
        >
          {chatOn ? <SquareTerminal size={14} /> : <MessagesSquare size={14} />}
        </button>
        <button title="Split right" onMouseDown={act(() => split('row'))}>
          <SplitSquareHorizontal size={14} />
        </button>
        <button title="Split down" onMouseDown={act(() => split('col'))}>
          <SplitSquareVertical size={14} />
        </button>
        {canClose && (
          <button
            title="Close pane"
            onMouseDown={(e) => {
              e.stopPropagation()
              focusPane(tabId, leaf.id)
              void confirmCloseLeaves([leaf.id]).then((proceed) => {
                if (proceed) closeFocused()
              })
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div className="pane__term">
        <div className="pane__termhost" style={{ display: chatOn ? 'none' : 'block' }}>
          <TerminalView
            key={`${leaf.id}:${leaf.cwd}`}
            id={leaf.id}
            persist
            kind="main"
            cwd={leaf.cwd}
            active={focused}
            onPasteReady={(p) => {
              pasteRef.current = p
              paneWriters.register(leaf.id, p)
            }}
            onCwd={(cwd) => useWorkspaceStore.getState().setPaneCwd(leaf.id, cwd)}
            onCwdFallback={(actualCwd) => {
              // The folder this pane wanted no longer exists — the shell fell
              // back to home instead of silently pretending it opened here.
              useWorkspaceStore.getState().setPaneCwd(leaf.id, actualCwd)
              useToastStore
                .getState()
                .push(`"${leaf.cwd}" is gone — opened a shell in ${actualCwd} instead.`, 'warning')
            }}
            onTitle={(title) => useWorkspaceStore.getState().setPaneTitle(leaf.id, title)}
            onStatus={(state, ask) => useMunuStore.getState().setPaneStatus(leaf.id, tabId, state, ask)}
            onOpenPath={(raw, line) => {
              // Resolve a path clicked in output to a project-relative path and open it.
              const p = toRelProjectPath(raw, useAppStore.getState().activeRoot)
              if (!p) return
              void useEditorStore.getState().open(p, p.split('/').pop() ?? p, line ?? undefined)
            }}
            onHoverPath={(raw, _line, x, y) => {
              if (!(useAppStore.getState().settings?.terminal.filePreviews ?? true)) return
              const p = toRelProjectPath(raw, useAppStore.getState().activeRoot)
              if (p) useFilePreviewStore.getState().requestShow(p, x, y)
            }}
            onLeavePath={() => useFilePreviewStore.getState().scheduleHide()}
            onActivity={() => markActivity(tabId)}
            fontFamily={t?.fontFamily ?? undefined}
            fontSize={t?.fontSize}
            cursorStyle={t?.cursorStyle}
            cursorBlink={t?.cursorBlink}
            scrollback={t?.scrollback}
            renderer={t?.renderer}
            lineHeight={t?.lineHeight}
            letterSpacing={t?.letterSpacing}
            macOptionIsMeta={t?.macOptionIsMeta}
          />
        </div>
        {chatOn && (
          <PaneChat
            key={leaf.id}
            cwd={paneCwdValue}
            leafId={leaf.id}
            active={tabActive}
            onShowTerminal={() => {
              useWorkspaceStore.getState().setPaneView(leaf.id, 'terminal')
              refocusIfTerminal(leaf.id)
            }}
          />
        )}
        {/* The floating ✎ would land right on the Composer's Send button, and chat
            mode already has its own ⌘⇧⏎ maximize control — so terminal only. */}
        {!chatOn && focused && (t?.composeOverlay ?? true) && (
          <button
            className="pane__compose"
            title="Compose a long prompt (⌘⇧⏎)"
            aria-label="Compose a long prompt"
            onClick={() => useComposeStore.getState().openCompose()}
          >
            <PenLine size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

export function PaneTree({
  node,
  tabId,
  focusedLeafId,
  tabActive,
  canClose,
  depth = 0
}: {
  node: LayoutNode
  tabId: string
  focusedLeafId: string
  tabActive: boolean
  canClose: boolean
  /** Tree depth; a leaf at depth 0 is the tab's only pane (so it needs no bar). */
  depth?: number
}) {
  if (node.type === 'leaf') {
    return (
      <TerminalPane
        leaf={node}
        tabId={tabId}
        focused={tabActive && node.id === focusedLeafId}
        tabActive={tabActive}
        canClose={canClose}
        hideBar={depth === 0}
      />
    )
  }
  return (
    <Group
      id={node.id}
      orientation={node.dir === 'row' ? 'horizontal' : 'vertical'}
      className="pane-group"
      onLayoutChanged={(layout) => {
        const sizes = node.children.map((c) => layout[c.id] ?? 100 / node.children.length)
        if (!sameSizes(sizes, node.sizes)) useWorkspaceStore.getState().resizeSplit(node.id, sizes)
      }}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <Separator className={`pane-resize pane-resize--${node.dir}`} />}
          <Panel id={child.id} defaultSize={node.sizes[i]} minSize={8} className="pane-panel">
            <PaneTree
              node={child}
              tabId={tabId}
              focusedLeafId={focusedLeafId}
              tabActive={tabActive}
              canClose
              depth={depth + 1}
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  )
}
