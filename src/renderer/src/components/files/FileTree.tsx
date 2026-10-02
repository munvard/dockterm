import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import {
  ArrowDownAZ,
  ArrowUpZA,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ClipboardCopy,
  Copy,
  CornerDownRight,
  FilePlus,
  FolderInput,
  FolderPlus,
  LocateFixed,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Trash2,
  X
} from 'lucide-react'
import type { TreeNode } from '@shared/ipc'
import type { FileSortBy } from '@shared/types'
import type { QuickHit } from '@shared/search/pathIndex'
import { cdCommand, quoteShellArg } from '@shared/shellQuote'
import { validEntryName } from '@shared/fileNames'
import { useEditorStore } from '../../state/useEditorStore'
import { useDialogStore } from '../../state/useDialogStore'
import { useToastStore } from '../../state/useToastStore'
import { useAppStore } from '../../state/useAppStore'
import { useGitStore } from '../../state/useGitStore'
import { useSearchStore } from '../../state/useSearchStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { useWindowedList } from '../../hooks/useWindowedList'
import { highlightRuns } from '../search/highlight'
import { indexNote } from '../search/QuickOpen'
import { selectClick, type SelState } from './fileSelect'
import { iconFor } from './fileIcons'
import { buildGitBadges } from './gitBadges'
import {
  ancestorsOf,
  breadcrumbOf,
  buildRows,
  navigate,
  parentPath,
  parseExpanded,
  planMoves,
  parseMovePayload,
  remapPath,
  remapSet,
  serializeExpanded,
  typeAhead,
  type CreatingState,
  type NavKey,
  type TreeRow
} from './treeModel'
import {
  baseName,
  copyToClipboard,
  joinAbs,
  joinRel,
  pasteToFocusedPane,
  focusedShellKind,
  platformName,
  sendPathsToTerminal
} from './pathActions'

const ROW_H = 24
const INDENT = 12
const MOVE_MIME = 'application/x-dockterm-move'
const FILTER_OWNER = 2
const SPRING_MS = 700
const NAV_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageDown', 'PageUp'])

const DEFAULT_FILES = {
  sortBy: 'name' as FileSortBy,
  sortDesc: false,
  foldersFirst: true,
  showHidden: true,
  showIgnored: false,
  searchIgnored: false
}

const expandedKey = (root: string): string => `dockterm.expanded.${root}`

interface Menu {
  x: number
  y: number
  /** The right-clicked row, or null for the empty area. */
  node: TreeNode | null
}

interface ViewMenu {
  x: number
  y: number
}

/** Rows hold names verbatim; a freshly typed name must not collide with a sibling. */
function nameTaken(list: readonly TreeNode[] | undefined, name: string, except?: string): boolean {
  return !!list?.some((n) => n.name === name && n.relPath !== except)
}

function InlineName(props: {
  initial: string
  isFile: boolean
  placeholder?: string
  onSubmit: (name: string) => string | null | Promise<string | null>
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = props.initial.lastIndexOf('.')
    el.setSelectionRange(0, props.isFile && dot > 0 ? dot : props.initial.length)
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (value: string): Promise<void> => {
    if (done.current) return
    const err = await props.onSubmit(value)
    if (err) {
      setError(err)
      ref.current?.focus()
      return
    }
    done.current = true
  }

  return (
    <input
      ref={ref}
      className={`xt__input${error ? ' xt__input--bad' : ''}`}
      defaultValue={props.initial}
      placeholder={props.placeholder}
      spellCheck={false}
      title={error ?? undefined}
      onClick={(e) => e.stopPropagation()}
      onChange={() => setError(null)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          void submit(e.currentTarget.value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          done.current = true
          props.onCancel()
        }
      }}
      onBlur={() => {
        if (!done.current) {
          done.current = true
          props.onCancel()
        }
      }}
    />
  )
}

export function FileTree() {
  const [children, setChildren] = useState<Record<string, TreeNode[]>>({})
  const [more, setMore] = useState<Record<string, number>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<SelState>({ selected: new Set(), anchor: null })
  const [cursor, setCursor] = useState<string | null>(null)
  const [creating, setCreating] = useState<CreatingState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [viewMenu, setViewMenu] = useState<ViewMenu | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<QuickHit[]>([])
  const [hitSel, setHitSel] = useState(0)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const viewMenuRef = useRef<HTMLDivElement | null>(null)
  const childrenRef = useRef(children)
  childrenRef.current = children
  const expandedRef = useRef(expanded)
  const rootRef = useRef<string | null>(null)
  const dragPaths = useRef<string[]>([])
  const spring = useRef<{ path: string; timer: number } | null>(null)
  const typed = useRef({ text: '', at: 0 })
  const pendingScroll = useRef<string | null>(null)
  const watchTimer = useRef(0)
  const filterSeq = useRef(0)

  const openFile = useEditorStore((s) => s.open)
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null)
  const projectName = useAppStore((s) => s.project?.name ?? 'Files')
  const activeRoot = useAppStore((s) => s.activeRoot)
  const files = useAppStore((s) => s.settings?.files) ?? DEFAULT_FILES
  const updatePreferences = useAppStore((s) => s.updatePreferences)
  const confirmDanger = useAppStore((s) => s.settings?.git.confirmDanger ?? true)
  const gitStatus = useGitStore((s) => s.status)
  const index = useSearchStore((s) => s.index)
  const confirm = useDialogStore((s) => s.confirm)
  const toast = useToastStore((s) => s.push)
  const headerName = (activeRoot && activeRoot.split(/[\\/]/).filter(Boolean).pop()) || projectName
  const badges = useMemo(() => buildGitBadges(gitStatus), [gitStatus])
  const showIgnoredRef = useRef(files.showIgnored)
  showIgnoredRef.current = files.showIgnored

  /* ------------------------------ loading ------------------------------ */

  const load = useCallback(
    async (relPath: string, opts?: { silent?: boolean }): Promise<void> => {
      const root = rootRef.current
      const res = await window.dockterm.invoke('fs:readDir', { relPath, showIgnored: showIgnoredRef.current })
      if (root !== rootRef.current) return
      if (res.ok) {
        setChildren((prev) => ({ ...prev, [relPath]: res.value.entries }))
        setMore((prev) => (prev[relPath] === res.value.more || (!prev[relPath] && !res.value.more) ? prev : { ...prev, [relPath]: res.value.more }))
        return
      }
      if (opts?.silent) {
        // A background refresh of a folder that is gone: drop it quietly instead of
        // toasting on every watch tick while it stays open.
        if (expandedRef.current.has(relPath)) mutateExpanded((p) => without(p, relPath))
        setChildren((prev) => {
          if (!(relPath in prev)) return prev
          const next = { ...prev }
          delete next[relPath]
          return next
        })
        return
      }
      toast(res.error.message, 'error')
    },
    // mutateExpanded only touches refs and setState, so it is stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast]
  )

  const without = (set: ReadonlySet<string>, path: string): Set<string> => {
    const next = new Set(set)
    next.delete(path)
    return next
  }

  const mutateExpanded = (fn: (prev: Set<string>) => Set<string>): void => {
    const next = fn(expandedRef.current)
    if (next === expandedRef.current) return
    expandedRef.current = next
    setExpanded(next)
    const root = rootRef.current
    if (root) {
      try {
        localStorage.setItem(expandedKey(root), serializeExpanded(next))
      } catch {
        // storage full or blocked: the tree still works, it just forgets
      }
    }
  }

  const reloadAll = useCallback(
    (silent: boolean): void => {
      void load('', { silent })
      for (const dir of expandedRef.current) void load(dir, { silent })
    },
    [load]
  )

  // Open a project (or retarget the dock to another root): restore what was open there.
  useEffect(() => {
    rootRef.current = activeRoot
    setChildren({})
    setMore({})
    setSel({ selected: new Set(), anchor: null })
    setCursor(null)
    setCreating(null)
    setRenaming(null)
    setFilterOpen(false)
    setQuery('')
    let restored = new Set<string>()
    if (activeRoot) {
      try {
        restored = parseExpanded(localStorage.getItem(expandedKey(activeRoot)))
      } catch {
        restored = new Set()
      }
    }
    expandedRef.current = restored
    setExpanded(restored)
    if (!activeRoot) return
    void load('')
    for (const dir of restored) void load(dir, { silent: true })
  }, [activeRoot, load])

  // The ignored toggle changes what a folder lists: read every open folder again.
  const firstIgnored = useRef(true)
  useEffect(() => {
    if (firstIgnored.current) {
      firstIgnored.current = false
      return
    }
    reloadAll(true)
  }, [files.showIgnored, reloadAll])

  useEffect(
    () =>
      window.dockterm.on('fs:watch', () => {
        // A burst of events (a checkout, an install) becomes one refresh.
        window.clearTimeout(watchTimer.current)
        watchTimer.current = window.setTimeout(() => reloadAll(true), 150)
      }),
    [reloadAll]
  )
  useEffect(() => () => window.clearTimeout(watchTimer.current), [])

  /* ------------------------------- rows -------------------------------- */

  const rows = useMemo(
    () =>
      buildRows(
        children,
        more,
        expanded,
        { sortBy: files.sortBy, sortDesc: files.sortDesc, foldersFirst: files.foldersFirst, showHidden: files.showHidden },
        creating
      ),
    [children, more, expanded, files.sortBy, files.sortDesc, files.foldersFirst, files.showHidden, creating]
  )
  const { range, scrollToIndex } = useWindowedList(scrollRef, rows.length, ROW_H, 10)

  const indexOfPath = useCallback(
    (rel: string): number => rows.findIndex((r) => r.kind === 'node' && r.node!.relPath === rel),
    [rows]
  )
  const orderPaths = useMemo(() => rows.filter((r) => r.kind === 'node').map((r) => r.node!.relPath), [rows])

  useEffect(() => {
    const target = pendingScroll.current
    if (!target) return
    const i = indexOfPath(target)
    if (i < 0) return
    pendingScroll.current = null
    scrollToIndex(i, 'center')
  }, [rows, indexOfPath, scrollToIndex])

  useEffect(() => {
    if (!cursor) return
    const i = indexOfPath(cursor)
    if (i >= 0) scrollToIndex(i)
  }, [cursor, indexOfPath, scrollToIndex])

  /* ----------------------------- selection ----------------------------- */

  const clearSel = (): void => setSel({ selected: new Set(), anchor: null })

  const toggleDir = (rel: string): void => {
    const open = expandedRef.current.has(rel)
    mutateExpanded((p) => {
      const next = new Set(p)
      if (open) next.delete(rel)
      else next.add(rel)
      return next
    })
    if (!open && !childrenRef.current[rel]) void load(rel)
  }

  const onRowClick = (e: MouseEvent, node: TreeNode): void => {
    scrollRef.current?.focus({ preventScroll: true })
    setCursor(node.relPath)
    const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }
    if (mods.meta || mods.shift) {
      setSel((s) => selectClick(s, node.relPath, mods, orderPaths))
      return
    }
    setSel({ selected: new Set([node.relPath]), anchor: node.relPath })
    if (node.type === 'dir') toggleDir(node.relPath)
    else void openFile(node.relPath, node.name)
  }

  const targetsFor = (node: TreeNode): string[] =>
    sel.selected.has(node.relPath) ? [...sel.selected] : [node.relPath]

  /* --------------------------- file operations -------------------------- */

  const remapEverywhere = (from: string, to: string): void => {
    mutateExpanded((p) => {
      const next = remapSet(p, from, to)
      return next.size === p.size && [...next].every((x) => p.has(x)) ? p : next
    })
    setSel((s) => ({ selected: remapSet(s.selected, from, to), anchor: s.anchor ? remapPath(s.anchor, from, to) : null }))
    setCursor((c) => (c ? remapPath(c, from, to) : c))
    const root = rootRef.current
    const ed = useEditorStore.getState()
    for (const t of ed.tabs) {
      if (t.root !== root) continue
      if (t.relPath === from || t.relPath.startsWith(`${from}/`)) {
        const np = remapPath(t.relPath, from, to)
        ed.renamePath(t.relPath, np, baseName(np))
      }
    }
  }

  const closeTabsUnder = (rel: string): void => {
    const root = rootRef.current
    const ed = useEditorStore.getState()
    for (const t of ed.tabs) {
      if (t.root === root && (t.relPath === rel || t.relPath.startsWith(`${rel}/`))) ed.close(t.id)
    }
  }

  const reloadDirs = async (dirs: string[]): Promise<void> => {
    await Promise.all([...new Set(dirs)].map((d) => load(d)))
  }

  const startCreate = async (parent: string, kind: 'file' | 'dir'): Promise<void> => {
    if (parent && !expandedRef.current.has(parent)) {
      mutateExpanded((p) => new Set(p).add(parent))
    }
    if (!childrenRef.current[parent]) await load(parent)
    setFilterOpen(false)
    setRenaming(null)
    setCreating({ parent, kind })
    pendingScroll.current = null
    window.requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: parent ? scrollRef.current.scrollTop : 0 }))
  }

  const submitCreate = async (name: string): Promise<string | null> => {
    const c = creating
    if (!c) return null
    const bad = validEntryName(name)
    if (bad) return bad
    const trimmed = name.trim()
    if (nameTaken(childrenRef.current[c.parent], trimmed)) return `"${trimmed}" already exists here`
    const relPath = joinRel(c.parent, trimmed)
    const res = await window.dockterm.invoke(c.kind === 'file' ? 'fs:createFile' : 'fs:createDir', { relPath })
    if (!res.ok) return res.error.message
    setCreating(null)
    await load(c.parent)
    pendingScroll.current = relPath
    setCursor(relPath)
    setSel({ selected: new Set([relPath]), anchor: relPath })
    if (c.kind === 'file') void openFile(relPath, trimmed)
    return null
  }

  const submitRename = async (node: TreeNode, name: string): Promise<string | null> => {
    const bad = validEntryName(name)
    if (bad) return bad
    const trimmed = name.trim()
    if (trimmed === node.name) {
      setRenaming(null)
      return null
    }
    const dir = parentPath(node.relPath)
    if (nameTaken(childrenRef.current[dir], trimmed, node.relPath)) return `"${trimmed}" already exists here`
    const to = joinRel(dir, trimmed)
    const res = await window.dockterm.invoke('fs:rename', { fromRelPath: node.relPath, toRelPath: to })
    if (!res.ok) return res.error.message
    setRenaming(null)
    remapEverywhere(node.relPath, to)
    pendingScroll.current = to
    await load(dir)
    return null
  }

  const duplicateNode = async (node: TreeNode): Promise<void> => {
    const res = await window.dockterm.invoke('fs:duplicate', { relPath: node.relPath })
    if (!res.ok) {
      toast(res.error.message, 'error')
      return
    }
    const dir = parentPath(node.relPath)
    await load(dir)
    pendingScroll.current = res.value.relPath
    setCursor(res.value.relPath)
    setSel({ selected: new Set([res.value.relPath]), anchor: res.value.relPath })
  }

  const deleteNodes = async (rels: string[]): Promise<void> => {
    if (rels.length === 0) return
    const top = rels.filter((r) => !rels.some((o) => o !== r && r.startsWith(`${o}/`)))
    const label = top.length === 1 ? `"${baseName(top[0])}"` : `${top.length} items`
    if (confirmDanger) {
      const ok = await confirm({
        title: top.length === 1 ? 'Delete' : 'Delete items',
        message: `Move ${label} to the trash?`,
        detail: 'Folders go to the trash with everything inside them.',
        confirmLabel: 'Move to Trash',
        danger: true,
        command: top.map((r) => `trash ${r}`).join('\n')
      })
      if (!ok) return
    }
    const parents: string[] = []
    for (const rel of top) {
      const res = await window.dockterm.invoke('fs:delete', { relPath: rel })
      if (!res.ok) {
        toast(res.error.message, 'error')
        continue
      }
      closeTabsUnder(rel)
      mutateExpanded((p) => {
        const next = new Set([...p].filter((x) => x !== rel && !x.startsWith(`${rel}/`)))
        return next.size === p.size ? p : next
      })
      parents.push(parentPath(rel))
    }
    clearSel()
    setCursor(null)
    await reloadDirs(parents)
  }

  /* ----------------------------- drag and drop --------------------------- */

  const clearSpring = (): void => {
    if (spring.current) window.clearTimeout(spring.current.timer)
    spring.current = null
  }

  const namesIn = (dir: string): Set<string> => new Set((childrenRef.current[dir] ?? []).map((n) => n.name))

  const canDropOn = (dest: string): boolean => {
    if (dragPaths.current.length === 0) return false
    return planMoves(dragPaths.current, dest, namesIn(dest)).moves.length > 0
  }

  const moveTo = async (sources: string[], dest: string): Promise<void> => {
    if (!childrenRef.current[dest]) await load(dest)
    const plan = planMoves(sources, dest, namesIn(dest))
    const parents: string[] = [dest]
    let moved = 0
    for (const m of plan.moves) {
      const res = await window.dockterm.invoke('fs:rename', { fromRelPath: m.from, toRelPath: m.to })
      if (!res.ok) {
        toast(res.error.message, 'error')
        continue
      }
      moved++
      parents.push(parentPath(m.from))
      remapEverywhere(m.from, m.to)
    }
    const taken = plan.skipped.filter((s) => s.reason === 'exists' || s.reason === 'duplicate-name')
    if (taken.length > 0) {
      toast(
        taken.length === 1
          ? `"${baseName(taken[0].from)}" already exists in ${dest ? `"${baseName(dest)}"` : 'the project root'}, skipped`
          : `${taken.length} items already exist there, skipped`,
        'error'
      )
    }
    if (moved > 0 && dest && !expandedRef.current.has(dest)) mutateExpanded((p) => new Set(p).add(dest))
    await reloadDirs(parents)
  }

  const onRowDragStart = (e: DragEvent, node: TreeNode): void => {
    if (!activeRoot) return
    const paths = sel.selected.has(node.relPath) ? [...sel.selected] : [node.relPath]
    if (e.altKey) {
      // Alt+drag hands the real files to the OS (Finder, a browser, a chat app).
      e.preventDefault()
      void window.dockterm.invoke('fs:startDrag', { relPaths: paths })
      return
    }
    dragPaths.current = paths
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData(MOVE_MIME, JSON.stringify({ root: activeRoot, paths }))
    if (paths.length === 1) {
      e.dataTransfer.setData('application/x-dockterm', JSON.stringify({ path: joinAbs(activeRoot, paths[0]), type: node.type }))
    }
    const shell = focusedShellKind()
    e.dataTransfer.setData('text/plain', paths.map((p) => quoteShellArg(joinAbs(activeRoot, p), shell)).join(' '))
  }

  const dropDestFor = (node: TreeNode | null): string => (node === null ? '' : node.type === 'dir' ? node.relPath : parentPath(node.relPath))

  const onDragOverTarget = (e: DragEvent, node: TreeNode | null): void => {
    if (!e.dataTransfer.types.includes(MOVE_MIME)) return
    const dest = dropDestFor(node)
    e.stopPropagation()
    if (!canDropOn(dest)) {
      if (dropTarget !== null) setDropTarget(null)
      clearSpring()
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    // Highlight the folder itself for a folder row; for a file, the folder that holds it.
    if (dropTarget !== dest) setDropTarget(dest)
    if (node && node.type === 'dir' && !expandedRef.current.has(node.relPath)) {
      if (spring.current?.path !== node.relPath) {
        clearSpring()
        const path = node.relPath
        spring.current = {
          path,
          timer: window.setTimeout(() => {
            spring.current = null
            toggleDir(path)
          }, SPRING_MS)
        }
      }
    } else if (spring.current && spring.current.path !== node?.relPath) {
      clearSpring()
    }
  }

  const endDrag = (): void => {
    clearSpring()
    setDropTarget(null)
    dragPaths.current = []
  }

  const onDropTarget = (e: DragEvent, node: TreeNode | null): void => {
    const raw = e.dataTransfer.getData(MOVE_MIME)
    if (!raw) return
    e.preventDefault()
    e.stopPropagation()
    const dest = dropDestFor(node)
    let sources: string[] = []
    try {
      // The payload names the project it came from; a drag from another window's project is ignored.
      sources = parseMovePayload(raw, activeRoot)
    } catch {
      sources = []
    }
    endDrag()
    if (sources.length > 0) void moveTo(sources, dest)
  }

  /* -------------------------------- keyboard ----------------------------- */

  const onKeyDown = (e: KeyboardEvent): void => {
    if (creating || renaming) return
    const mac = platformName() === 'darwin'
    const current = cursor ? indexOfPath(cursor) : -1
    const nodeAt = (i: number): TreeNode | null => (i >= 0 && rows[i]?.kind === 'node' ? rows[i].node! : null)

    if (NAV_KEYS.has(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 240) / ROW_H) - 1)
      const r = navigate(rows, expandedRef.current, current, e.key as NavKey, page)
      if (r.toggle) toggleDir(r.toggle.path)
      const n = nodeAt(r.index)
      if (n) {
        setCursor(n.relPath)
        if (e.shiftKey && !r.toggle) setSel((s) => selectClick(s.anchor ? s : { selected: new Set(), anchor: cursor }, n.relPath, { shift: true }, orderPaths))
        else if (!e.shiftKey) setSel({ selected: new Set([n.relPath]), anchor: n.relPath })
      }
      return
    }
    const node = nodeAt(current)
    if (e.key === 'Enter' && node && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      if (node.type === 'dir') toggleDir(node.relPath)
      else void openFile(node.relPath, node.name)
      return
    }
    if (e.key === 'F2' && node) {
      e.preventDefault()
      setRenaming(node.relPath)
      return
    }
    if (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) {
      const rels = node ? (sel.selected.has(node.relPath) ? [...sel.selected] : [node.relPath]) : [...sel.selected]
      if (rels.length) {
        e.preventDefault()
        void deleteNodes(rels)
      }
      return
    }
    if (e.key === 'Escape') {
      if (sel.selected.size > 0) {
        e.preventDefault()
        clearSel()
      }
      return
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now()
      const stale = now - typed.current.at > 800
      if (e.key === ' ' && stale) return
      const buf = stale ? e.key : typed.current.text + e.key
      typed.current = { text: buf, at: now }
      const i = typeAhead(rows, current, buf)
      const n = nodeAt(i)
      if (n) {
        e.preventDefault()
        setCursor(n.relPath)
        setSel({ selected: new Set([n.relPath]), anchor: n.relPath })
      }
    }
  }

  /* ------------------------------ reveal etc. ---------------------------- */

  const revealPath = async (rel: string, select: boolean): Promise<void> => {
    setFilterOpen(false)
    setQuery('')
    const anc = ancestorsOf(rel)
    mutateExpanded((p) => {
      const next = new Set(p)
      for (const a of anc) next.add(a)
      return next
    })
    await Promise.all([!childrenRef.current[''] ? load('') : Promise.resolve(), ...anc.filter((a) => !childrenRef.current[a]).map((a) => load(a))])
    await load(parentPath(rel))
    pendingScroll.current = rel
    setCursor(rel)
    if (select) setSel({ selected: new Set([rel]), anchor: rel })
    if (!files.showHidden && rel.split('/').some((p) => p.startsWith('.'))) {
      toast('That path is inside a hidden item. Turn on Show hidden files to see it.', 'info')
    }
  }

  const activeRel = activeTab && activeTab.root === activeRoot ? activeTab.relPath : null

  const collapseAll = (): void => {
    mutateExpanded(() => new Set())
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const setFiles = (patch: Partial<typeof DEFAULT_FILES>): void => {
    void updatePreferences({ files: patch })
  }

  /* -------------------------------- filter ------------------------------- */

  const indexKey = index ? `${index.state}:${index.phase}:${Math.floor(index.files / 500)}` : 'none'
  useEffect(() => {
    const q = query.trim()
    if (!filterOpen || !q) {
      setHits([])
      return
    }
    const mine = ++filterSeq.current
    const t = window.setTimeout(() => {
      void window.dockterm
        .invoke('search:files', {
          query: q,
          includeIgnored: files.showIgnored,
          kinds: 'both',
          limit: 200,
          recent: [],
          owner: FILTER_OWNER
        })
        .then((r) => {
          if (mine !== filterSeq.current || !r.ok || r.value.stale) return
          setHits(r.value.results.hits)
          setHitSel(0)
        })
    }, 40)
    return () => window.clearTimeout(t)
  }, [query, filterOpen, files.showIgnored, activeRoot, indexKey])

  const openHit = (hit: QuickHit): void => {
    if (hit.isDir) {
      void revealPath(hit.relPath, true)
      return
    }
    useSearchStore.getState().pushRecent(hit.relPath)
    void openFile(hit.relPath, baseName(hit.relPath))
  }

  /* ------------------------------- menus -------------------------------- */

  useEffect(() => {
    if (!menu && !viewMenu) return
    const close = (): void => {
      setMenu(null)
      setViewMenu(null)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, viewMenu])

  useLayoutEffect(() => {
    for (const [el, pos] of [
      [menuRef.current, menu],
      [viewMenuRef.current, viewMenu]
    ] as const) {
      if (!el || !pos) continue
      const rect = el.getBoundingClientRect()
      el.style.left = `${Math.max(4, Math.min(pos.x, window.innerWidth - rect.width - 4))}px`
      el.style.top = `${Math.max(4, Math.min(pos.y, window.innerHeight - rect.height - 4))}px`
    }
  }, [menu, viewMenu])

  const onContext = (e: MouseEvent, node: TreeNode | null): void => {
    e.preventDefault()
    e.stopPropagation()
    setViewMenu(null)
    if (node) {
      setCursor(node.relPath)
      if (!sel.selected.has(node.relPath)) setSel({ selected: new Set([node.relPath]), anchor: node.relPath })
    }
    setMenu({ x: e.clientX, y: e.clientY, node })
  }

  const menuAct = (fn: () => void | Promise<void>): (() => void) => () => {
    setMenu(null)
    void fn()
  }

  /* ---------------------------- selection bar --------------------------- */

  const sendSelection = (): void => {
    if (sendPathsToTerminal([...sel.selected])) clearSel()
  }
  const copySelectionPaths = (): void => {
    if (!activeRoot) return
    const paths = [...sel.selected].map((rel) => joinAbs(activeRoot, rel))
    void copyToClipboard(paths.join('\n'), `${paths.length} path${paths.length > 1 ? 's' : ''}`)
  }

  /* -------------------------------- render ------------------------------ */

  const gitCls = (rel: string): string => {
    const b = badges.get(rel)
    return b ? ` xt__name--${b.cls}` : ''
  }

  const renderNodeRow = (row: TreeRow, i: number) => {
    const node = row.node!
    const isDir = node.type === 'dir'
    const isOpen = isDir && expanded.has(node.relPath)
    const { Icon, tone } = iconFor(node.name, isDir, isOpen)
    const badge = badges.get(node.relPath)
    const selected = sel.selected.has(node.relPath)
    const dropHere = isDir && dropTarget === node.relPath
    const cls = [
      'xt__row',
      selected && 'xt__row--selected',
      cursor === node.relPath && 'xt__row--cursor',
      node.ignored && 'xt__row--ignored',
      dropHere && 'xt__row--drop',
      !isDir && dropTarget !== null && dropTarget === parentPath(node.relPath) && dropTarget !== '' && 'xt__row--sibling-drop'
    ]
      .filter(Boolean)
      .join(' ')
    return (
      <div
        key={row.key}
        id={`xt-${i}`}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-selected={selected}
        aria-expanded={isDir ? isOpen : undefined}
        className={cls}
        style={{ paddingLeft: 8 + row.depth * INDENT }}
        draggable={renaming !== node.relPath}
        onDragStart={(e) => onRowDragStart(e, node)}
        onDragEnd={endDrag}
        onDragOver={(e) => onDragOverTarget(e, node)}
        onDrop={(e) => onDropTarget(e, node)}
        onClick={(e) => onRowClick(e, node)}
        onContextMenu={(e) => onContext(e, node)}
        title={node.relPath}
      >
        <span className="xt__chev">
          {isDir ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        <Icon size={14} className={`ficon ficon--${tone}`} />
        {renaming === node.relPath ? (
          <InlineName
            initial={node.name}
            isFile={!isDir}
            onSubmit={(v) => submitRename(node, v)}
            onCancel={() => {
              setRenaming(null)
              scrollRef.current?.focus({ preventScroll: true })
            }}
          />
        ) : (
          <span className={`xt__name${gitCls(node.relPath)}`}>{node.name}</span>
        )}
        {badge && renaming !== node.relPath && (
          isDir ? (
            <span className={`xt__dot xt__dot--${badge.cls}`} title="Contains changes" />
          ) : (
            <span className={`git-badge git-badge--${badge.cls}`} title={`Git: ${badge.letter}`}>
              {badge.letter}
            </span>
          )
        )}
      </div>
    )
  }

  const renderRow = (row: TreeRow, i: number) => {
    if (row.kind === 'node') return renderNodeRow(row, i)
    const pad = { paddingLeft: 8 + row.depth * INDENT }
    if (row.kind === 'create') {
      const isFile = row.createKind === 'file'
      const { Icon, tone } = iconFor('', !isFile, false)
      return (
        <div key={row.key} className="xt__row xt__row--create" style={pad}>
          <span className="xt__chev" />
          <Icon size={14} className={`ficon ficon--${tone}`} />
          <InlineName
            initial=""
            isFile={isFile}
            placeholder={isFile ? 'File name' : 'Folder name'}
            onSubmit={submitCreate}
            onCancel={() => {
              setCreating(null)
              scrollRef.current?.focus({ preventScroll: true })
            }}
          />
        </div>
      )
    }
    if (row.kind === 'more') {
      return (
        <div
          key={row.key}
          className="xt__row xt__row--note xt__row--more"
          style={pad}
          title="This folder is too large to list in full. Use Quick Open or the filter to find a file in it."
          onClick={() => useSearchStore.getState().openQuick()}
        >
          <span className="xt__chev" />
          <span className="xt__note">{row.more!.toLocaleString()} more not shown. Find a file with Quick Open</span>
        </div>
      )
    }
    return (
      <div key={row.key} className="xt__row xt__row--note" style={pad}>
        <span className="xt__chev" />
        <span className="xt__note">Empty folder</span>
      </div>
    )
  }

  const menuNode = menu?.node ?? null
  const menuTargets = menuNode ? targetsFor(menuNode) : []
  const menuDir = menuNode ? (menuNode.type === 'dir' ? menuNode.relPath : parentPath(menuNode.relPath)) : ''
  const createParent = menuNode ? (menuNode.type === 'dir' ? menuNode.relPath : parentPath(menuNode.relPath)) : ''
  const absOf = (rel: string): string => (activeRoot ? joinAbs(activeRoot, rel) : rel)
  const filtering = filterOpen && query.trim() !== ''
  const sortLabels: Record<FileSortBy, string> = { name: 'Name', type: 'Type', modified: 'Date modified', size: 'Size' }

  return (
    <div className="panel xt">
      <div className="panel__head">
        <span className="panel__title">{headerName}</span>
        <div className="panel__actions">
          <button
            className={`iconbtn iconbtn--sm${filterOpen ? ' iconbtn--active' : ''}`}
            title="Filter files"
            onClick={() => {
              setFilterOpen((o) => !o)
              setQuery('')
            }}
          >
            <Search size={14} />
          </button>
          <button className="iconbtn iconbtn--sm" title="New file" onClick={() => void startCreate(menuDirForHeader(), 'file')}>
            <FilePlus size={14} />
          </button>
          <button className="iconbtn iconbtn--sm" title="New folder" onClick={() => void startCreate(menuDirForHeader(), 'dir')}>
            <FolderPlus size={14} />
          </button>
          <button
            className="iconbtn iconbtn--sm"
            title="Reveal the open file in the tree"
            disabled={!activeRel}
            onClick={() => activeRel && void revealPath(activeRel, true)}
          >
            <LocateFixed size={14} />
          </button>
          <button className="iconbtn iconbtn--sm" title="Collapse all folders" onClick={collapseAll}>
            <ChevronsDownUp size={14} />
          </button>
          <button
            className={`iconbtn iconbtn--sm${viewMenu ? ' iconbtn--active' : ''}`}
            title="Sort and view"
            onClick={(e) => {
              e.stopPropagation()
              setMenu(null)
              const r = e.currentTarget.getBoundingClientRect()
              setViewMenu(viewMenu ? null : { x: r.right - 190, y: r.bottom + 4 })
            }}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>
      {filterOpen && (
        <div className="xt__filter">
          <Search size={13} className="xt__filter-icon" />
          <input
            className="xt__filter-input"
            value={query}
            placeholder="Filter files and folders"
            autoFocus
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setFilterOpen(false)
                setQuery('')
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHitSel((s) => Math.min(hits.length - 1, s + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHitSel((s) => Math.max(0, s - 1))
              } else if (e.key === 'Enter' && hits[hitSel]) {
                e.preventDefault()
                openHit(hits[hitSel])
              }
            }}
          />
          {query && (
            <button className="xt__filter-clear" title="Clear" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
      {activeRel && !filterOpen && (
        <div className="xt__crumbs" title={activeRel}>
          {breadcrumbOf(activeRel).map((c, i, all) => (
            <span key={c.relPath} className="xt__crumb-wrap">
              {i > 0 && <ChevronRight size={10} className="xt__crumb-sep" />}
              <button
                className={`xt__crumb${i === all.length - 1 ? ' xt__crumb--last' : ''}`}
                onClick={() => void revealPath(c.relPath, true)}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>
      )}
      {filtering ? (
        <div className="panel__body xt__results" role="listbox">
          {hits.length === 0 ? (
            <div className="xt__empty">
              {index && index.state !== 'ready' ? indexNote(index, files.showIgnored) : files.showIgnored ? 'No matches' : 'No matches. Turn on Show ignored in the view menu to include node_modules and build folders.'}
            </div>
          ) : (
            hits.map((hit, i) => {
              const name = baseName(hit.relPath)
              const dirPart = hit.relPath.slice(0, hit.relPath.length - name.length).replace(/\/$/, '')
              const { Icon, tone } = iconFor(name, hit.isDir, false)
              const nameStart = hit.relPath.length - name.length
              return (
                <div
                  key={hit.relPath}
                  role="option"
                  aria-selected={i === hitSel}
                  className={`xt__row xt__hit${i === hitSel ? ' xt__row--cursor xt__row--selected' : ''}${hit.ignored ? ' xt__row--ignored' : ''}`}
                  onClick={() => openHit(hit)}
                  onMouseMove={() => setHitSel(i)}
                  title={hit.relPath}
                >
                  <Icon size={14} className={`ficon ficon--${tone}`} />
                  <span className="xt__name">{highlightRuns(name, nameStart, hit.positions)}</span>
                  {dirPart && <span className="xt__path">{dirPart}</span>}
                </div>
              )
            })
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={`panel__body xt__scroll${dropTarget === '' ? ' xt__scroll--drop' : ''}`}
          tabIndex={0}
          role="tree"
          aria-label="Project files"
          aria-activedescendant={cursor && indexOfPath(cursor) >= 0 ? `xt-${indexOfPath(cursor)}` : undefined}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => onContext(e, null)}
          onDragOver={(e) => onDragOverTarget(e, null)}
          onDrop={(e) => onDropTarget(e, null)}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setDropTarget(null)
              clearSpring()
            }
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSel()
          }}
        >
          <div className="xt__spacer" style={{ height: range.height }}>
            <div className="xt__window" style={{ transform: `translateY(${range.start * ROW_H}px)` }}>
              {rows.slice(range.start, range.end).map((row, k) => renderRow(row, range.start + k))}
            </div>
          </div>
          {rows.length === 0 && children[''] !== undefined && <div className="xt__empty">This folder is empty</div>}
        </div>
      )}
      {sel.selected.size > 0 && (
        <div className="selbar">
          <span className="selbar__count">
            <b>{sel.selected.size}</b>
            <span className="selbar__word">selected</span>
          </span>
          <button className="selbar__send" onClick={sendSelection}>
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
      {viewMenu && (
        <div className="ctxmenu xt__menu" ref={viewMenuRef} style={{ left: viewMenu.x, top: viewMenu.y }} onClick={(e) => e.stopPropagation()}>
          <div className="xt__menu-head">Sort by</div>
          {(Object.keys(sortLabels) as FileSortBy[]).map((k) => (
            <button key={k} onClick={() => setFiles({ sortBy: k })}>
              <span className="xt__check">{files.sortBy === k && <Check size={13} />}</span>
              {sortLabels[k]}
            </button>
          ))}
          <button onClick={() => setFiles({ sortDesc: !files.sortDesc })}>
            <span className="xt__check">{files.sortDesc ? <ArrowUpZA size={13} /> : <ArrowDownAZ size={13} />}</span>
            {files.sortDesc ? 'Descending' : 'Ascending'}
          </button>
          <div className="ctxmenu__sep" />
          <button onClick={() => setFiles({ foldersFirst: !files.foldersFirst })}>
            <span className="xt__check">{files.foldersFirst && <Check size={13} />}</span>
            Folders first
          </button>
          <button onClick={() => setFiles({ showHidden: !files.showHidden })}>
            <span className="xt__check">{files.showHidden && <Check size={13} />}</span>
            Show hidden files
          </button>
          <button onClick={() => setFiles({ showIgnored: !files.showIgnored })}>
            <span className="xt__check">{files.showIgnored && <Check size={13} />}</span>
            Show ignored (node_modules, build)
          </button>
          <div className="ctxmenu__sep" />
          <button
            onClick={() => {
              setViewMenu(null)
              reloadAll(false)
            }}
          >
            <span className="xt__check">
              <RefreshCw size={13} />
            </span>
            Refresh
          </button>
        </div>
      )}
      {menu && (
        <div className="ctxmenu" ref={menuRef} style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button onClick={menuAct(() => startCreate(createParent, 'file'))}>
            <FilePlus size={13} /> New File
          </button>
          <button onClick={menuAct(() => startCreate(createParent, 'dir'))}>
            <FolderPlus size={13} /> New Folder
          </button>
          {menuNode && <div className="ctxmenu__sep" />}
          {menuNode && (
            <>
              {menuTargets.length === 1 && (
                <>
                  <button onClick={menuAct(() => setRenaming(menuNode.relPath))}>
                    <Pencil size={13} /> Rename
                  </button>
                  <button onClick={menuAct(() => duplicateNode(menuNode))}>
                    <Copy size={13} /> Duplicate
                  </button>
                </>
              )}
              <button
                onClick={menuAct(() =>
                  copyToClipboard(menuTargets.map(absOf).join('\n'), menuTargets.length > 1 ? 'paths' : 'path')
                )}
              >
                <ClipboardCopy size={13} /> Copy Path
              </button>
              <button onClick={menuAct(() => copyToClipboard(menuTargets.join('\n'), menuTargets.length > 1 ? 'relative paths' : 'relative path'))}>
                <ClipboardCopy size={13} /> Copy Relative Path
              </button>
              <div className="ctxmenu__sep" />
              <button onClick={menuAct(() => void sendPathsToTerminal(menuTargets))}>
                <Sparkles size={13} /> Send to Terminal
              </button>
              <button onClick={menuAct(() => useWorkspaceStore.getState().open(absOf(menuDir)))}>
                <SquareTerminal size={13} /> Open in Terminal Here
              </button>
              <button
                onClick={menuAct(() => {
                  const text = cdCommand(absOf(menuDir), focusedShellKind())
                  if (!pasteToFocusedPane(text)) toast('Open a terminal first to change its folder', 'error')
                })}
              >
                <CornerDownRight size={13} /> cd Here in the Focused Terminal
              </button>
              <button onClick={menuAct(() => void window.dockterm.invoke('fs:reveal', { relPath: menuNode.relPath }))}>
                <FolderInput size={13} /> Reveal in OS
              </button>
              <div className="ctxmenu__sep" />
              <button className="ctxmenu__danger" onClick={menuAct(() => deleteNodes(menuTargets))}>
                <Trash2 size={13} /> {menuTargets.length > 1 ? `Delete ${menuTargets.length} Items` : 'Delete'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )

  /** Header "new" buttons create in the selected folder, else beside the selected file, else at the root. */
  function menuDirForHeader(): string {
    const c = cursor ? [...(Object.values(children).flat())].find((n) => n.relPath === cursor) : null
    if (!c) return ''
    return c.type === 'dir' ? c.relPath : parentPath(c.relPath)
  }
}
