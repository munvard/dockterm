import { describe, it, expect } from 'vitest'
import type { TreeNode } from '@shared/ipc'
import {
  ancestorsOf,
  breadcrumbOf,
  buildRows,
  navigate,
  parseExpanded,
  parseMovePayload,
  planMoves,
  remapPath,
  remapSet,
  serializeExpanded,
  sortNodes,
  typeAhead,
  type ViewOpts
} from '../../src/renderer/src/components/files/treeModel'

const d = (relPath: string, extra: Partial<TreeNode> = {}): TreeNode => ({ name: relPath.split('/').pop()!, relPath, type: 'dir', ...extra })
const f = (relPath: string, extra: Partial<TreeNode> = {}): TreeNode => ({ name: relPath.split('/').pop()!, relPath, type: 'file', ...extra })
const view: ViewOpts = { sortBy: 'name', sortDesc: false, foldersFirst: true, showHidden: true }

describe('sortNodes', () => {
  it('sorts names naturally, folders first', () => {
    const out = sortNodes([f('a10.ts'), f('a2.ts'), d('zdir'), f('B.ts')], view).map((n) => n.name)
    expect(out).toEqual(['zdir', 'a2.ts', 'a10.ts', 'B.ts'])
  })
  it('mixes folders and files when folders-first is off', () => {
    const out = sortNodes([f('b.ts'), d('c'), f('a.ts')], { ...view, foldersFirst: false }).map((n) => n.name)
    expect(out).toEqual(['a.ts', 'b.ts', 'c'])
  })
  it('sorts by size and modified, and reverses', () => {
    const nodes = [f('a', { size: 5, mtimeMs: 30 }), f('b', { size: 9, mtimeMs: 10 }), f('c', { size: 1, mtimeMs: 20 })]
    expect(sortNodes(nodes, { ...view, sortBy: 'size' }).map((n) => n.name)).toEqual(['c', 'a', 'b'])
    expect(sortNodes(nodes, { ...view, sortBy: 'modified', sortDesc: true }).map((n) => n.name)).toEqual(['a', 'c', 'b'])
  })
  it('sorts by extension for type', () => {
    const out = sortNodes([f('x.ts'), f('y.md'), f('z.css')], { ...view, sortBy: 'type' }).map((n) => n.name)
    expect(out).toEqual(['z.css', 'y.md', 'x.ts'])
  })
})

describe('buildRows', () => {
  const children = {
    '': [f('.env'), d('src'), f('a.ts')],
    src: [f('src/x.ts')],
    empty: []
  }
  it('unfolds open folders and hides dotfiles on request', () => {
    const rows = buildRows(children, {}, new Set(['src']), { ...view, showHidden: false }, null)
    expect(rows.map((r) => r.key)).toEqual(['src', 'src/x.ts', 'a.ts'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0])
  })
  it('adds a create row first in its folder and an N more row last', () => {
    const rows = buildRows(children, { src: 7 }, new Set(['src']), view, { parent: 'src', kind: 'file' })
    const keys = rows.map((r) => r.key)
    expect(keys).toContain('create:src')
    expect(keys.indexOf('create:src')).toBe(keys.indexOf('src') + 1)
    const more = rows.find((r) => r.kind === 'more')!
    expect(more.more).toBe(7)
    expect(keys.indexOf('more:src')).toBeGreaterThan(keys.indexOf('src/x.ts'))
  })
  it('marks an open empty folder', () => {
    const rows = buildRows({ '': [d('empty')], empty: [] }, {}, new Set(['empty']), view, null)
    expect(rows.map((r) => r.kind)).toEqual(['node', 'empty'])
  })
})

describe('navigate', () => {
  const children = { '': [d('a'), f('b.ts')], a: [f('a/c.ts')] }
  const open = new Set(['a'])
  const rows = buildRows(children, {}, open, view, null)
  it('moves up and down and clamps', () => {
    expect(navigate(rows, open, 0, 'ArrowDown').index).toBe(1)
    expect(navigate(rows, open, 2, 'ArrowDown').index).toBe(2)
    expect(navigate(rows, open, 0, 'ArrowUp').index).toBe(0)
    expect(navigate(rows, open, 0, 'End').index).toBe(2)
    expect(navigate(rows, open, 2, 'Home').index).toBe(0)
  })
  it('right opens a closed folder, then enters it', () => {
    const closedRows = buildRows(children, {}, new Set(), view, null)
    expect(navigate(closedRows, new Set(), 0, 'ArrowRight').toggle).toEqual({ path: 'a', open: true })
    expect(navigate(rows, open, 0, 'ArrowRight').index).toBe(1)
  })
  it('left closes an open folder, else jumps to the parent', () => {
    expect(navigate(rows, open, 0, 'ArrowLeft').toggle).toEqual({ path: 'a', open: false })
    expect(navigate(rows, open, 1, 'ArrowLeft').index).toBe(0)
  })
  it('starts at an end when nothing is focused', () => {
    expect(navigate(rows, open, -1, 'ArrowDown').index).toBe(0)
    expect(navigate(rows, open, -1, 'ArrowUp').index).toBe(2)
  })
})

describe('typeAhead', () => {
  const rows = buildRows({ '': [f('alpha'), f('beta'), f('alto')] }, {}, new Set(), { ...view, foldersFirst: false }, null)
  it('jumps to a prefix and cycles on a repeated letter', () => {
    expect(typeAhead(rows, 0, 'be')).toBe(2)
    expect(typeAhead(rows, 0, 'a')).toBe(1)
    expect(typeAhead(rows, 1, 'aa')).toBe(0)
    expect(typeAhead(rows, 0, 'zz')).toBe(-1)
  })
})

describe('planMoves', () => {
  it('moves into a folder under the same names', () => {
    expect(planMoves(['a.ts', 'dir/b.ts'], 'dest', new Set()).moves).toEqual([
      { from: 'a.ts', to: 'dest/a.ts' },
      { from: 'dir/b.ts', to: 'dest/b.ts' }
    ])
  })
  it('moves to the root', () => {
    expect(planMoves(['dir/b.ts'], '', new Set()).moves).toEqual([{ from: 'dir/b.ts', to: 'b.ts' }])
  })
  it('skips into itself, into a descendant, the same folder and taken names', () => {
    const p = planMoves(['a', 'x/b.ts', 'c.ts', 'd.ts'], 'a/sub', new Set(['d.ts']))
    expect(p.skipped.find((s) => s.from === 'a')?.reason).toBe('into-itself')
    expect(p.moves.map((m) => m.from)).toEqual(['x/b.ts', 'c.ts'])
    expect(planMoves(['x/b.ts'], 'x', new Set(['b.ts'])).skipped[0].reason).toBe('same-folder')
    expect(planMoves(['q.ts'], 'x', new Set(['q.ts'])).skipped[0].reason).toBe('exists')
  })
  it('does not move a child that rides along with its selected folder, and flags equal names', () => {
    expect(planMoves(['a', 'a/b.ts'], 'z', new Set()).moves).toEqual([{ from: 'a', to: 'z/a' }])
    const p = planMoves(['m/same.ts', 'n/same.ts'], 'z', new Set())
    expect(p.moves).toHaveLength(1)
    expect(p.skipped[0].reason).toBe('duplicate-name')
  })
})

describe('remap and paths', () => {
  it('remaps a path and what is inside it', () => {
    expect(remapPath('a/b/c.ts', 'a/b', 'z/b')).toBe('z/b/c.ts')
    expect(remapPath('a/bc', 'a/b', 'z/b')).toBe('a/bc')
    expect([...remapSet(new Set(['a', 'a/b', 'q']), 'a', 'z/a')].sort()).toEqual(['q', 'z/a', 'z/a/b'])
  })
  it('lists ancestors and breadcrumbs', () => {
    expect(ancestorsOf('a/b/c.ts')).toEqual(['a', 'a/b'])
    expect(ancestorsOf('c.ts')).toEqual([])
    expect(breadcrumbOf('a/b/c.ts').map((c) => c.relPath)).toEqual(['a', 'a/b', 'a/b/c.ts'])
  })
})

describe('expansion memory', () => {
  it('round-trips and survives bad input', () => {
    expect(parseExpanded(serializeExpanded(new Set(['b', 'a'])))).toEqual(new Set(['a', 'b']))
    expect(parseExpanded('not json').size).toBe(0)
    expect(parseExpanded('{"a":1}').size).toBe(0)
    expect(parseExpanded(null).size).toBe(0)
  })
  it('caps the remembered folders', () => {
    const big = new Set(Array.from({ length: 1000 }, (_, i) => `d${i}`))
    expect(parseExpanded(serializeExpanded(big)).size).toBe(400)
  })
})

describe('parseMovePayload', () => {
  it('returns the paths for a drag from this project and nothing for another project or a bad payload', () => {
    const raw = JSON.stringify({ root: '/p/x', paths: ['src/a.ts', 3, 'b.ts'] })
    expect(parseMovePayload(raw, '/p/x')).toEqual(['src/a.ts', 'b.ts'])
    expect(parseMovePayload(raw, '/p/y')).toEqual([])
    expect(parseMovePayload(raw, null)).toEqual([])
    expect(parseMovePayload(JSON.stringify(['src/a.ts']), '/p/x')).toEqual([])
    expect(parseMovePayload('nope', '/p/x')).toEqual([])
  })
})
