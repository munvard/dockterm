import { describe, it, expect } from 'vitest'
import {
  type LeafNode,
  type LayoutNode,
  allLeaves,
  findLeaf,
  firstLeaf,
  splitLeaf,
  closeLeaf,
  setSizes,
  setLeafCwd,
  gridPreset
} from '@renderer/state/layout'

const leaf = (id: string): LeafNode => ({ type: 'leaf', id, cwd: '/p', title: id })

describe('layout tree', () => {
  it('splits a single leaf into a 2-pane split', () => {
    const r = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    expect(r).toMatchObject({ type: 'split', dir: 'row', id: 's1' })
    expect(allLeaves(r).map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('inserts flat when splitting in the same direction', () => {
    let r: LayoutNode = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    r = splitLeaf(r, 'b', 'row', leaf('c'), 's2')
    expect(r.type).toBe('split')
    if (r.type === 'split') {
      expect(r.children.map((c) => c.type)).toEqual(['leaf', 'leaf', 'leaf'])
      expect(r.sizes).toEqual([100 / 3, 100 / 3, 100 / 3])
    }
    expect(allLeaves(r).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('wraps in a nested split when splitting in a different direction', () => {
    let r: LayoutNode = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    r = splitLeaf(r, 'b', 'col', leaf('c'), 's2')
    expect(allLeaves(r).map((l) => l.id)).toEqual(['a', 'b', 'c'])
    if (r.type === 'split') {
      expect(r.dir).toBe('row')
      expect(r.children[1].type).toBe('split')
    }
  })

  it('closeLeaf collapses a 2-pane split back to a leaf', () => {
    const split = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    expect(closeLeaf(split, 'b')).toMatchObject({ type: 'leaf', id: 'a' })
  })

  it('closeLeaf removes a pane from a 3-pane split and rebalances', () => {
    let r: LayoutNode = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    r = splitLeaf(r, 'b', 'row', leaf('c'), 's2')
    const closed = closeLeaf(r, 'b')
    expect(closed && allLeaves(closed).map((l) => l.id)).toEqual(['a', 'c'])
    if (closed && closed.type === 'split') expect(closed.sizes).toEqual([50, 50])
  })

  it('closeLeaf returns null for the only leaf', () => {
    expect(closeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('setSizes updates a split by id', () => {
    const r = setSizes(splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1'), 's1', [70, 30])
    if (r.type === 'split') expect(r.sizes).toEqual([70, 30])
  })

  it('gridPreset builds rows x cols leaves', () => {
    let n = 0
    const g = gridPreset(2, 3, () => leaf(`l${n++}`), () => `s${n++}`)
    expect(allLeaves(g)).toHaveLength(6)
    expect(g.type).toBe('split')
    if (g.type === 'split') {
      expect(g.dir).toBe('col')
      expect(g.children).toHaveLength(2)
      for (const row of g.children) {
        expect(row.type).toBe('split')
        if (row.type === 'split') expect(row.children).toHaveLength(3)
      }
    }
  })

  it('setLeafCwd retargets only the matching leaf', () => {
    const r = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    const next = setLeafCwd(r, 'b', '/other/project', 'project')
    expect(findLeaf(next, 'b')).toMatchObject({ cwd: '/other/project', title: 'project' })
    expect(findLeaf(next, 'a')).toMatchObject({ cwd: '/p', title: 'a' })
  })

  it('setLeafCwd leaves the tree unchanged for an unknown id', () => {
    const r = leaf('a')
    expect(setLeafCwd(r, 'z', '/x', 'x')).toMatchObject({ cwd: '/p', title: 'a' })
  })

  it('findLeaf and firstLeaf locate leaves', () => {
    const r = splitLeaf(leaf('a'), 'a', 'row', leaf('b'), 's1')
    expect(findLeaf(r, 'b')?.id).toBe('b')
    expect(findLeaf(r, 'z')).toBeNull()
    expect(firstLeaf(r).id).toBe('a')
  })
})
