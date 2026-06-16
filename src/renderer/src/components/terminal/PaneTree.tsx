import { Fragment, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import type { LayoutNode, LeafNode } from '../../state/layout'
import { TerminalView } from './TerminalView'

function sameSizes(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.5)
}

/** Double-quote a path when it contains whitespace (works on Windows + POSIX). */
function quotePath(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p
}

function TerminalPane({
  leaf,
  tabId,
  focused,
  canClose
}: {
  leaf: LeafNode
  tabId: string
  focused: boolean
  canClose: boolean
}) {
  const t = useAppStore((s) => s.settings?.terminal)
  const focusPane = useWorkspaceStore((s) => s.focusPane)
  const split = useWorkspaceStore((s) => s.splitFocused)
  const closeFocused = useWorkspaceStore((s) => s.closeFocused)
  const markActivity = useWorkspaceStore((s) => s.markActivity)
  const retargetLeaf = useWorkspaceStore((s) => s.retargetLeaf)
  const pasteRef = useRef<(text: string) => void>(() => {})
  const [dragOver, setDragOver] = useState(false)

  const act = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    focusPane(tabId, leaf.id)
    fn()
  }

  const onDragOver = (e: DragEvent) => {
    const dt = e.dataTransfer
    const hasPayload =
      dt.types.includes('application/x-dockterm') ||
      dt.types.includes('Files') ||
      dt.types.includes('text/plain')
    if (!hasPayload) return
    e.preventDefault()
    dt.dropEffect = 'copy'
    if (!dragOver) setDragOver(true)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    focusPane(tabId, leaf.id)

    // From the file tree (or anything emitting our payload). A folder retargets
    // this pane to that directory; a file is typed at the prompt.
    const internal = e.dataTransfer.getData('application/x-dockterm')
    if (internal) {
      try {
        const { path, type } = JSON.parse(internal) as { path: string; type: 'file' | 'dir' }
        if (path && type === 'dir') retargetLeaf(tabId, leaf.id, path)
        else if (path) pasteRef.current(quotePath(path))
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
        .map(quotePath)
      if (paths.length) pasteRef.current(paths.join(' '))
      return
    }

    // Last resort: plain-text path payload.
    const text = e.dataTransfer.getData('text/plain')
    if (text) pasteRef.current(quotePath(text))
  }

  return (
    <div
      className={`pane${focused ? ' pane--focused' : ''}${dragOver ? ' pane--drop' : ''}`}
      onMouseDown={() => focusPane(tabId, leaf.id)}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="pane__bar">
        <span className="pane__title">{leaf.title}</span>
        <div className="pane__actions">
          <button title="Split right" onMouseDown={act(() => split('row'))}>
            <SplitSquareHorizontal size={12} />
          </button>
          <button title="Split down" onMouseDown={act(() => split('col'))}>
            <SplitSquareVertical size={12} />
          </button>
          {canClose && (
            <button title="Close pane" onMouseDown={act(() => closeFocused())}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="pane__term">
        <TerminalView
          key={`${leaf.id}:${leaf.cwd}`}
          kind="main"
          cwd={leaf.cwd}
          active={focused}
          onPasteReady={(p) => (pasteRef.current = p)}
          onActivity={() => markActivity(tabId)}
          fontFamily={t?.fontFamily ?? undefined}
          fontSize={t?.fontSize}
          cursorStyle={t?.cursorStyle}
          cursorBlink={t?.cursorBlink}
          scrollback={t?.scrollback}
          renderer={t?.renderer}
        />
      </div>
    </div>
  )
}

export function PaneTree({
  node,
  tabId,
  focusedLeafId,
  tabActive,
  canClose
}: {
  node: LayoutNode
  tabId: string
  focusedLeafId: string
  tabActive: boolean
  canClose: boolean
}) {
  if (node.type === 'leaf') {
    return (
      <TerminalPane
        leaf={node}
        tabId={tabId}
        focused={tabActive && node.id === focusedLeafId}
        canClose={canClose}
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
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  )
}
