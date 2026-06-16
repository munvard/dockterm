import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Pencil,
  Trash2,
  FolderInput
} from 'lucide-react'
import type { TreeNode } from '@shared/ipc'
import { useEditorStore } from '../../state/useEditorStore'
import { useDialogStore } from '../../state/useDialogStore'
import { useToastStore } from '../../state/useToastStore'
import { useAppStore } from '../../state/useAppStore'

interface Menu {
  x: number
  y: number
  node: TreeNode | null
}

function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

/** Join a project root with a forward-slash relPath, matching the root's separator. */
function joinAbs(root: string, relPath: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const rel = sep === '\\' ? relPath.split('/').join('\\') : relPath
  return root.endsWith(sep) ? root + rel : root + sep + rel
}

export function FileTree() {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<Menu | null>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  const openFile = useEditorStore((s) => s.open)
  const closeTab = useEditorStore((s) => s.close)
  const projectName = useAppStore((s) => s.project?.name ?? 'Files')
  const activeRoot = useAppStore((s) => s.activeRoot)
  const headerName =
    (activeRoot && activeRoot.split(/[\\/]/).filter(Boolean).pop()) || projectName
  const confirmDanger = useAppStore((s) => s.settings?.git.confirmDanger ?? true)
  const confirm = useDialogStore((s) => s.confirm)
  const prompt = useDialogStore((s) => s.prompt)
  const toast = useToastStore((s) => s.push)

  const load = useCallback(
    async (relPath: string) => {
      const res = await window.dockterm.invoke('fs:readTree', { relPath })
      if (res.ok) setChildren((prev) => ({ ...prev, [relPath]: res.value }))
      else toast(res.error.message, 'error')
    },
    [toast]
  )

  const refresh = useCallback(() => {
    void load('')
    for (const dir of expandedRef.current) void load(dir)
  }, [load])

  // (Re)load the tree on mount and whenever the dock retargets to another
  // project root (focusing a pane in a different directory).
  useEffect(() => {
    setExpanded(new Set())
    setChildren({})
    void load('')
  }, [activeRoot, load])

  useEffect(() => window.dockterm.on('fs:watch', refresh), [refresh])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const toggleDir = (node: TreeNode) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.relPath)) {
        next.delete(node.relPath)
      } else {
        next.add(node.relPath)
        if (!children[node.relPath]) void load(node.relPath)
      }
      return next
    })
  }

  const newFile = async (dir: string) => {
    const name = await prompt({
      title: 'New file',
      label: 'File name',
      placeholder: 'example.ts',
      confirmLabel: 'Create'
    })
    if (!name) return
    const relPath = dir ? `${dir}/${name}` : name
    const res = await window.dockterm.invoke('fs:createFile', { relPath })
    if (!res.ok) {
      toast(res.error.message, 'error')
      return
    }
    await load(dir)
    if (dir) setExpanded((p) => new Set(p).add(dir))
    void openFile(relPath, name)
  }

  const newFolder = async (dir: string) => {
    const name = await prompt({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' })
    if (!name) return
    const relPath = dir ? `${dir}/${name}` : name
    const res = await window.dockterm.invoke('fs:createDir', { relPath })
    if (!res.ok) {
      toast(res.error.message, 'error')
      return
    }
    await load(dir)
  }

  const renameNode = async (node: TreeNode) => {
    const name = await prompt({
      title: `Rename ${node.type}`,
      label: 'New name',
      initial: node.name,
      confirmLabel: 'Rename'
    })
    if (!name || name === node.name) return
    const dir = parentOf(node.relPath)
    const toRelPath = dir ? `${dir}/${name}` : name
    const res = await window.dockterm.invoke('fs:rename', { fromRelPath: node.relPath, toRelPath })
    if (!res.ok) {
      toast(res.error.message, 'error')
      return
    }
    if (node.type === 'file') {
      closeTab(node.relPath)
      void openFile(toRelPath, name)
    }
    await load(dir)
  }

  const deleteNode = async (node: TreeNode) => {
    if (confirmDanger) {
      const confirmed = await confirm({
        title: `Delete ${node.type}`,
        message: `Move "${node.name}" to the trash?`,
        detail:
          node.type === 'dir' ? 'The folder and everything inside it goes to the trash.' : undefined,
        confirmLabel: 'Move to Trash',
        danger: true,
        command: `trash ${node.relPath}`
      })
      if (!confirmed) return
    }
    const res = await window.dockterm.invoke('fs:delete', { relPath: node.relPath })
    if (!res.ok) {
      toast(res.error.message, 'error')
      return
    }
    if (node.type === 'file') closeTab(node.relPath)
    await load(parentOf(node.relPath))
  }

  const reveal = (node: TreeNode) => {
    void window.dockterm.invoke('fs:reveal', { relPath: node.relPath })
  }

  const onContext = (e: MouseEvent, node: TreeNode | null) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  const renderNodes = (parentRel: string, depth: number) =>
    (children[parentRel] ?? []).map((node) => {
      const isOpen = expanded.has(node.relPath)
      return (
        <div key={node.relPath}>
          <div
            className="tree__row"
            style={{ paddingLeft: 6 + depth * 12 }}
            draggable={!!activeRoot}
            onDragStart={(e) => {
              if (!activeRoot) return
              const abs = joinAbs(activeRoot, node.relPath)
              e.dataTransfer.setData(
                'application/x-dockterm',
                JSON.stringify({ path: abs, type: node.type })
              )
              e.dataTransfer.setData('text/plain', abs)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => (node.type === 'dir' ? toggleDir(node) : void openFile(node.relPath, node.name))}
            onContextMenu={(e) => onContext(e, node)}
            title={node.name}
          >
            {node.type === 'dir' ? (
              <>
                {isOpen ? (
                  <ChevronDown size={13} className="tree__chev" />
                ) : (
                  <ChevronRight size={13} className="tree__chev" />
                )}
                {isOpen ? (
                  <FolderOpen size={14} className="tree__icon tree__icon--dir" />
                ) : (
                  <Folder size={14} className="tree__icon tree__icon--dir" />
                )}
              </>
            ) : (
              <>
                <span className="tree__chev" />
                <FileIcon size={14} className="tree__icon" />
              </>
            )}
            <span className="tree__name">{node.name}</span>
          </div>
          {node.type === 'dir' && isOpen && renderNodes(node.relPath, depth + 1)}
        </div>
      )
    })

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">{headerName}</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="New file" onClick={() => void newFile('')}>
            <FilePlus size={14} />
          </button>
          <button className="iconbtn iconbtn--sm" title="New folder" onClick={() => void newFolder('')}>
            <FolderPlus size={14} />
          </button>
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={refresh}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body tree" onContextMenu={(e) => onContext(e, null)}>
        {renderNodes('', 0)}
      </div>
      {menu && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {(menu.node === null || menu.node.type === 'dir') && (
            <>
              <button onClick={() => void newFile(menu.node ? menu.node.relPath : '')}>
                <FilePlus size={13} /> New File
              </button>
              <button onClick={() => void newFolder(menu.node ? menu.node.relPath : '')}>
                <FolderPlus size={13} /> New Folder
              </button>
              {menu.node && <div className="ctxmenu__sep" />}
            </>
          )}
          {menu.node && (
            <>
              <button onClick={() => void renameNode(menu.node!)}>
                <Pencil size={13} /> Rename
              </button>
              <button onClick={() => reveal(menu.node!)}>
                <FolderInput size={13} /> Reveal in OS
              </button>
              <button className="ctxmenu__danger" onClick={() => void deleteNode(menu.node!)}>
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
