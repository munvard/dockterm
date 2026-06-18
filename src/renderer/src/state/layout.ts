/** Pure recursive tiling-layout tree for a tab's terminals (no React). A tab's
 * content is a LayoutNode: either a single terminal (leaf) or a split of nodes.
 * `dir: 'row'` lays children out side by side (columns); `'col'` stacks them. */

export interface LeafNode {
  type: 'leaf'
  id: string
  cwd: string
  title: string
}

export interface SplitNode {
  type: 'split'
  id: string
  dir: 'row' | 'col'
  /** Percentage size per child (same length as `children`). */
  sizes: number[]
  children: LayoutNode[]
}

export type LayoutNode = LeafNode | SplitNode

export function equalSizes(n: number): number[] {
  return Array.from({ length: n }, () => 100 / n)
}

/** Structural validation of an untrusted (persisted) layout tree. Guards the
 * render path against malformed state that would otherwise throw and — with no
 * error boundary — blank the whole app on every launch. */
export function isValidLayout(node: unknown): node is LayoutNode {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  if (n.type === 'leaf') {
    return typeof n.id === 'string' && typeof n.cwd === 'string' && typeof n.title === 'string'
  }
  if (n.type === 'split') {
    if (typeof n.id !== 'string') return false
    if (n.dir !== 'row' && n.dir !== 'col') return false
    if (!Array.isArray(n.children) || n.children.length < 2) return false
    if (!Array.isArray(n.sizes) || n.sizes.length !== n.children.length) return false
    if (!n.sizes.every((s) => typeof s === 'number' && Number.isFinite(s) && s > 0)) return false
    return n.children.every(isValidLayout)
  }
  return false
}

export function allLeaves(node: LayoutNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : node.children.flatMap(allLeaves)
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === id ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, id)
    if (found) return found
  }
  return null
}

export function firstLeaf(node: LayoutNode): LeafNode {
  return node.type === 'leaf' ? node : firstLeaf(node.children[0])
}

/** Split `leafId` along `dir`, inserting `newLeaf`. Inserts flat when the parent
 * already runs in the same direction; otherwise wraps in a new split (`splitId`). */
export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  dir: 'row' | 'col',
  newLeaf: LeafNode,
  splitId: string
): LayoutNode {
  if (root.type === 'leaf') {
    if (root.id !== leafId) return root
    return { type: 'split', id: splitId, dir, sizes: equalSizes(2), children: [root, newLeaf] }
  }
  const idx = root.children.findIndex((c) => c.type === 'leaf' && c.id === leafId)
  if (idx >= 0) {
    if (root.dir === dir) {
      const children = [...root.children]
      children.splice(idx + 1, 0, newLeaf)
      return { ...root, children, sizes: equalSizes(children.length) }
    }
    const children = [...root.children]
    children[idx] = {
      type: 'split',
      id: splitId,
      dir,
      sizes: equalSizes(2),
      children: [root.children[idx], newLeaf]
    }
    return { ...root, children }
  }
  return { ...root, children: root.children.map((c) => splitLeaf(c, leafId, dir, newLeaf, splitId)) }
}

/** Remove `leafId`; collapse single-child splits. Returns null if it was the
 * only leaf. Sizes are re-balanced only in the split that lost a direct child. */
export function closeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root
  const children = root.children
    .map((c) => closeLeaf(c, leafId))
    .filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  const directChildRemoved = children.length !== root.children.length
  return { ...root, children, sizes: directChildRemoved ? equalSizes(children.length) : root.sizes }
}

/** Retarget `leafId` to a new working directory (and matching title). */
export function setLeafCwd(root: LayoutNode, leafId: string, cwd: string, title: string): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === leafId ? { ...root, cwd, title } : root
  }
  return { ...root, children: root.children.map((c) => setLeafCwd(c, leafId, cwd, title)) }
}

export function setSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.type === 'leaf') return root
  if (root.id === splitId) return { ...root, sizes }
  return { ...root, children: root.children.map((c) => setSizes(c, splitId, sizes)) }
}

/** Swap the positions of two leaves in the tree (drag-to-reorder). The whole
 * leaf nodes are exchanged, so each terminal keeps its id+cwd and the pool keeps
 * its running shell alive — only their slots in the layout change. No-op if
 * either id is missing or they're the same. */
export function swapLeaves(root: LayoutNode, aId: string, bId: string): LayoutNode {
  if (aId === bId) return root
  const a = findLeaf(root, aId)
  const b = findLeaf(root, bId)
  if (!a || !b) return root
  const replace = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') {
      if (node.id === aId) return b
      if (node.id === bId) return a
      return node
    }
    return { ...node, children: node.children.map(replace) }
  }
  return replace(root)
}

/** Build a `rows`×`cols` grid of fresh leaves. */
export function gridPreset(
  rows: number,
  cols: number,
  makeLeaf: () => LeafNode,
  makeSplitId: () => string
): LayoutNode {
  const makeRow = (): LayoutNode =>
    cols === 1
      ? makeLeaf()
      : {
          type: 'split',
          id: makeSplitId(),
          dir: 'row',
          sizes: equalSizes(cols),
          children: Array.from({ length: cols }, () => makeLeaf())
        }
  if (rows === 1) return makeRow()
  return {
    type: 'split',
    id: makeSplitId(),
    dir: 'col',
    sizes: equalSizes(rows),
    children: Array.from({ length: rows }, makeRow)
  }
}
