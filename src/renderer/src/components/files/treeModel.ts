import type { TreeNode } from '@shared/ipc'
import type { FileSortBy } from '@shared/types'

export interface SortOpts {
  sortBy: FileSortBy
  sortDesc: boolean
  foldersFirst: boolean
}

export interface ViewOpts extends SortOpts {
  showHidden: boolean
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function compareNodes(a: TreeNode, b: TreeNode, o: SortOpts): number {
  if (o.foldersFirst && a.type !== b.type) return a.type === 'dir' ? -1 : 1
  let primary = 0
  switch (o.sortBy) {
    case 'name':
      primary = collator.compare(a.name, b.name)
      break
    case 'type':
      primary = a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : collator.compare(extOf(a.name), extOf(b.name))
      break
    case 'modified':
      primary = (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0)
      break
    case 'size':
      primary = (a.size ?? 0) - (b.size ?? 0)
      break
  }
  if (primary !== 0) return o.sortDesc ? -primary : primary
  return collator.compare(a.name, b.name)
}

export function sortNodes(nodes: readonly TreeNode[], o: SortOpts): TreeNode[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, o))
}

export type RowKind = 'node' | 'more' | 'create' | 'empty'

export interface TreeRow {
  kind: RowKind
  key: string
  depth: number
  /** The folder this row lives in ('' = project root). */
  dir: string
  node?: TreeNode
  /** For a 'more' row: how many entries were left out. */
  more?: number
  /** For a 'create' row. */
  createKind?: 'file' | 'dir'
}

export interface CreatingState {
  parent: string
  kind: 'file' | 'dir'
}

/** The visible rows, top to bottom: sorted, hidden files filtered, open folders unfolded. */
export function buildRows(
  children: Readonly<Record<string, TreeNode[]>>,
  more: Readonly<Record<string, number>>,
  expanded: ReadonlySet<string>,
  opts: ViewOpts,
  creating: CreatingState | null
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (dir: string, depth: number): void => {
    const list = children[dir]
    if (list === undefined) return
    if (creating && creating.parent === dir) {
      rows.push({ kind: 'create', key: `create:${dir}`, depth, dir, createKind: creating.kind })
    }
    const visible = sortNodes(
      opts.showHidden ? list : list.filter((n) => !n.name.startsWith('.')),
      opts
    )
    for (const node of visible) {
      rows.push({ kind: 'node', key: node.relPath, depth, dir, node })
      if (node.type === 'dir' && expanded.has(node.relPath)) walk(node.relPath, depth + 1)
    }
    if (visible.length === 0 && !(creating && creating.parent === dir) && dir !== '') {
      rows.push({ kind: 'empty', key: `empty:${dir}`, depth, dir })
    }
    const extra = more[dir] ?? 0
    if (extra > 0) rows.push({ kind: 'more', key: `more:${dir}`, depth, dir, more: extra })
  }
  walk('', 0)
  return rows
}

export type NavKey = 'ArrowDown' | 'ArrowUp' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'PageDown' | 'PageUp'

export interface NavResult {
  index: number
  /** Expand or collapse this folder as part of the move. */
  toggle?: { path: string; open: boolean }
}

function stepNode(rows: readonly TreeRow[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (rows[i].kind === 'node') return i
  return from
}

/** Keyboard navigation over the visible rows (VS Code's tree rules). `index` is the current node row, or -1. */
export function navigate(
  rows: readonly TreeRow[],
  expanded: ReadonlySet<string>,
  index: number,
  key: NavKey,
  page = 10
): NavResult {
  const first = stepNode(rows, -1, 1)
  const last = stepNode(rows, rows.length, -1)
  const hasNodes = rows.some((r) => r.kind === 'node')
  if (!hasNodes) return { index: -1 }
  if (index < 0 || index >= rows.length || rows[index].kind !== 'node') {
    return { index: key === 'ArrowUp' || key === 'End' ? last : first }
  }
  const row = rows[index]
  const node = row.node!
  switch (key) {
    case 'ArrowDown':
      return { index: stepNode(rows, index, 1) }
    case 'ArrowUp':
      return { index: stepNode(rows, index, -1) }
    case 'Home':
      return { index: first }
    case 'End':
      return { index: last }
    case 'PageDown': {
      let i = index
      for (let n = 0; n < page; n++) i = stepNode(rows, i, 1)
      return { index: i }
    }
    case 'PageUp': {
      let i = index
      for (let n = 0; n < page; n++) i = stepNode(rows, i, -1)
      return { index: i }
    }
    case 'ArrowRight': {
      if (node.type !== 'dir') return { index }
      if (!expanded.has(node.relPath)) return { index, toggle: { path: node.relPath, open: true } }
      const next = rows[index + 1]
      return next && next.kind === 'node' && next.depth === row.depth + 1 ? { index: index + 1 } : { index }
    }
    case 'ArrowLeft': {
      if (node.type === 'dir' && expanded.has(node.relPath)) return { index, toggle: { path: node.relPath, open: false } }
      for (let i = index - 1; i >= 0; i--) {
        if (rows[i].kind === 'node' && rows[i].depth < row.depth) return { index: i }
      }
      return { index }
    }
  }
}

/**
 * Type-to-jump: the first node row whose name starts with `buffer`, searching from the
 * current row (wrapping). A buffer of one repeated letter ("aa") cycles through the
 * names starting with that letter, starting after the current row.
 */
export function typeAhead(rows: readonly TreeRow[], from: number, buffer: string): number {
  const b = buffer.toLowerCase()
  if (!b) return -1
  const repeated = b.length > 0 && [...b].every((c) => c === b[0])
  const needle = repeated ? b[0] : b
  const skipCurrent = repeated ? 1 : 0
  const n = rows.length
  for (let k = 0; k < n; k++) {
    const i = (Math.max(from, 0) + skipCurrent + k) % n
    const r = rows[i]
    if (r.kind === 'node' && r.node!.name.toLowerCase().startsWith(needle)) return i
  }
  return -1
}

export function parentPath(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

/** 'a/b/c.ts' gives ['a', 'a/b']: the folders that must be open to show the file. */
export function ancestorsOf(relPath: string): string[] {
  const parts = relPath.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

export function breadcrumbOf(relPath: string): Array<{ name: string; relPath: string }> {
  const parts = relPath.split('/').filter(Boolean)
  return parts.map((name, i) => ({ name, relPath: parts.slice(0, i + 1).join('/') }))
}

export interface MovePlan {
  moves: Array<{ from: string; to: string }>
  skipped: Array<{ from: string; reason: 'into-itself' | 'same-folder' | 'exists' | 'duplicate-name' }>
}

/**
 * Work out what dropping `sources` onto folder `destDir` should do. A selected folder
 * carries its selected children with it, so those are not moved twice; a move into
 * itself, into its own parent, or onto a name that is already taken is skipped.
 */
export function planMoves(sources: readonly string[], destDir: string, namesInDest: ReadonlySet<string>): MovePlan {
  const unique = [...new Set(sources)]
  const top = unique.filter((s) => !unique.some((o) => o !== s && s.startsWith(`${o}/`)))
  const moves: MovePlan['moves'] = []
  const skipped: MovePlan['skipped'] = []
  const taken = new Set(namesInDest)
  for (const from of top) {
    const name = from.slice(from.lastIndexOf('/') + 1)
    if (destDir === from || destDir.startsWith(`${from}/`)) {
      skipped.push({ from, reason: 'into-itself' })
    } else if (parentPath(from) === destDir) {
      skipped.push({ from, reason: 'same-folder' })
    } else if (namesInDest.has(name)) {
      skipped.push({ from, reason: 'exists' })
    } else if (taken.has(name)) {
      skipped.push({ from, reason: 'duplicate-name' })
    } else {
      taken.add(name)
      moves.push({ from, to: destDir ? `${destDir}/${name}` : name })
    }
  }
  return { moves, skipped }
}

/** Where `p` ends up when `from` is renamed to `to` (it may be `from` itself or something inside it). */
export function remapPath(p: string, from: string, to: string): string {
  if (p === from) return to
  return p.startsWith(`${from}/`) ? to + p.slice(from.length) : p
}

export function remapSet(set: ReadonlySet<string>, from: string, to: string): Set<string> {
  const out = new Set<string>()
  for (const p of set) out.add(remapPath(p, from, to))
  return out
}

const MAX_REMEMBERED = 400

export function serializeExpanded(expanded: ReadonlySet<string>): string {
  return JSON.stringify([...expanded].sort().slice(0, MAX_REMEMBERED))
}

export function parseExpanded(raw: string | null): Set<string> {
  if (!raw) return new Set()
  try {
    const v = JSON.parse(raw) as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, MAX_REMEMBERED) : [])
  } catch {
    return new Set()
  }
}

/** The relPaths of a drag payload, or [] when it came from a different project root. */
export function parseMovePayload(raw: string, root: string | null): string[] {
  try {
    const v = JSON.parse(raw) as { root?: unknown; paths?: unknown } | null
    if (!v || typeof v.root !== 'string' || v.root !== root || !Array.isArray(v.paths)) return []
    return v.paths.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}
