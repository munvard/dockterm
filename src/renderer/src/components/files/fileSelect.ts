import type { TreeNode } from '@shared/ipc'

export interface SelState {
  selected: Set<string>
  /** The pivot for shift-range selection (the last plainly/meta-clicked path). */
  anchor: string | null
}

export interface ClickMods {
  meta?: boolean // ⌘ on macOS / Ctrl elsewhere — toggle
  shift?: boolean // range from the anchor
}

/**
 * Pure file-tree selection reducer. `order` is the flattened list of currently
 * visible paths (render order), used for shift-range selection.
 */
export function selectClick(
  state: SelState,
  path: string,
  mods: ClickMods,
  order: string[]
): SelState {
  if (mods.shift && state.anchor) {
    const a = order.indexOf(state.anchor)
    const b = order.indexOf(path)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      return { selected: new Set(order.slice(lo, hi + 1)), anchor: state.anchor }
    }
  }
  if (mods.meta) {
    const selected = new Set(state.selected)
    if (selected.has(path)) selected.delete(path)
    else selected.add(path)
    return { selected, anchor: path }
  }
  return { selected: new Set([path]), anchor: path }
}

/** Flatten the loaded tree into visible paths in render order (DFS, expanded dirs only). */
export function flattenVisible(
  children: Record<string, TreeNode[]>,
  expanded: Set<string>,
  parent = ''
): string[] {
  const out: string[] = []
  for (const node of children[parent] ?? []) {
    out.push(node.relPath)
    if (node.type === 'dir' && expanded.has(node.relPath)) {
      out.push(...flattenVisible(children, expanded, node.relPath))
    }
  }
  return out
}
