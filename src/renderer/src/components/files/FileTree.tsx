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
  FolderInput,
  Search,
  Sparkles,
  ClipboardCopy,
  X
} from 'lucide-react'
import type { TreeNode } from '@shared/ipc'
import { useEditorStore } from '../../state/useEditorStore'
import { useDialogStore } from '../../state/useDialogStore'
import { useToastStore } from '../../state/useToastStore'
import { useAppStore } from '../../state/useAppStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { paneWriters } from '../../state/paneWriters'
import { selectClick, flattenVisible, type SelState } from './fileSelect'

/** Write text into the currently focused terminal pane (for "Send to Claude"). */
function writeToFocusedPane(text: string): boolean {
  const { tabs, activeId } = useWorkspaceStore.getState()
  const tab = tabs.find((t) => t.id === activeId)
  return tab ? paneWriters.write(tab.focusedLeafId, text) : false
}

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
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TreeNode[]>([])
  const [sel, setSel] = useState<SelState>({ selected: new Set(), anchor: null })
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
    setSel({ selected: new Set(), anchor: null })
    void load('')
  }, [activeRoot, load])

  const quote = (p: string): string => (/\s/.test(p) ? `"${p}"` : p)
  const clearSel = (): void => setSel({ selected: new Set(), anchor: null })

  // Click with ⌘/Ctrl or Shift edits the multi-selection; a plain click selects
  // just this row and opens/expands it.
  const onRowClick = (e: MouseEvent, node: TreeNode): void => {
    const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }
    if (mods.meta || mods.shift) {
      setSel((s) => selectClick(s, node.relPath, mods, flattenVisible(children, expanded)))
      return
    }
    setSel({ selected: new Set([node.relPath]), anchor: node.relPath })
    if (node.type === 'dir') toggleDir(node)
    else void openFile(node.relPath, node.name)
  }

  const sendSelectionToClaude = (): void => {
    if (!activeRoot) return
    const text = [...sel.selected].map((rel) => quote(joinAbs(activeRoot, rel))).join(' ') + ' '
    if (writeToFocusedPane(text)) clearSel()
    else toast('Open a terminal first to send files to Claude', 'error')
  }

  const copySelectionPaths = (): void => {
    if (!activeRoot) return
    const paths = [...sel.selected].map((rel) => joinAbs(activeRoot, rel))
    void navigator.clipboard.writeText(paths.join('\n'))
    toast(`Copied ${paths.length} path${paths.length > 1 ? 's' : ''}`, 'success')
  }

  useEffect(() => window.dockterm.on('fs:watch', refresh), [refresh])

  // Live file search (debounced): a jailed, bounded recursive name match in main,
  // shown as a flat result list while there's a query.
  useEffect(() => {
    const q = query.trim()
    if (!searchOpen || !q) {
      setResults([])
      return
    }
    const t = setTimeout(() => {
      void window.dockterm.invoke('fs:search', { query: q }).then((res) => {
        if (res.ok) setResults(res.value)
      })
    }, 160)
    return () => clearTimeout(t)
  }, [query, searchOpen, activeRoot])

  const openResult = (node: TreeNode): void => {
    if (node.type === 'file') {
      void openFile(node.relPath, node.name)
      return
    }
    // Expand the folder + its ancestors in the tree, then leave search mode.
    const parts = node.relPath.split('/')
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('/'))
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const a of ancestors) {
        next.add(a)
        if (!children[a]) void load(a)
      }
      return next
    })
    setSearchOpen(false)
    setQuery('')
  }

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
            className={`tree__row${sel.selected.has(node.relPath) ? ' tree__row--selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            draggable={!!activeRoot}
            onDragStart={(e) => {
              if (!activeRoot) return
              // Drag the whole selection if this row is part of it, else just this
              // row. Native OS drag of the REAL files (drop into Finder, browsers,
              // chat apps, etc.) — and DockTerm panes read the files on drop too.
              const paths = sel.selected.has(node.relPath) ? [...sel.selected] : [node.relPath]
              e.preventDefault()
              void window.dockterm.invoke('fs:startDrag', { relPaths: paths })
            }}
            onClick={(e) => onRowClick(e, node)}
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
          <button
            className={`iconbtn iconbtn--sm${searchOpen ? ' iconbtn--active' : ''}`}
            title="Search files"
            onClick={() => {
              setSearchOpen((o) => !o)
              setQuery('')
            }}
          >
            <Search size={14} />
          </button>
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
      {searchOpen && (
        <div className="tree__search">
          <Search size={13} className="tree__search-icon" />
          <input
            className="tree__search-input"
            value={query}
            placeholder="Search files…"
            autoFocus
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false)
                setQuery('')
              }
            }}
          />
          {query && (
            <button className="tree__search-clear" title="Clear" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
      <div className="panel__body tree" onContextMenu={(e) => onContext(e, null)}>
        {searchOpen && query.trim() ? (
          results.length === 0 ? (
            <div className="tree__empty">No matches</div>
          ) : (
            results.map((node) => (
              <div
                key={node.relPath}
                className="tree__row tree__row--result"
                onClick={() => openResult(node)}
                title={node.relPath}
              >
                <span className="tree__chev" />
                {node.type === 'dir' ? (
                  <Folder size={14} className="tree__icon tree__icon--dir" />
                ) : (
                  <FileIcon size={14} className="tree__icon" />
                )}
                <span className="tree__name">{node.name}</span>
                <span className="tree__path">{node.relPath}</span>
              </div>
            ))
          )
        ) : (
          renderNodes('', 0)
        )}
      </div>
      {sel.selected.size > 0 && (
        <div className="selbar">
          <span className="selbar__count">
            <b>{sel.selected.size}</b>
            <span className="selbar__word">selected</span>
          </span>
          <button className="selbar__send" onClick={sendSelectionToClaude}>
            <Sparkles size={13} />
            <span>Send to Claude</span>
          </button>
          <span className="selbar__tools">
            <button className="selbar__icon" title="Copy paths" onClick={copySelectionPaths}>
              <ClipboardCopy size={14} />
            </button>
            <button className="selbar__icon" title="Clear selection" onClick={clearSel}>
              <X size={14} />
            </button>
          </span>
        </div>
      )}
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
