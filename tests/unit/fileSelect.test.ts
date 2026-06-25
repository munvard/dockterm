import { describe, it, expect } from 'vitest'
import { selectClick, flattenVisible } from '../../src/renderer/src/components/files/fileSelect'
import type { TreeNode } from '@shared/ipc'

const order = ['a', 'b', 'c', 'd', 'e']

describe('selectClick', () => {
  const start = { selected: new Set<string>(), anchor: null }

  it('plain click selects a single item and anchors it', () => {
    const s = selectClick(start, 'c', {}, order)
    expect([...s.selected]).toEqual(['c'])
    expect(s.anchor).toBe('c')
  })

  it('meta/ctrl click toggles an item into and out of the selection', () => {
    let s = selectClick({ selected: new Set(['a']), anchor: 'a' }, 'c', { meta: true }, order)
    expect([...s.selected].sort()).toEqual(['a', 'c'])
    s = selectClick(s, 'c', { meta: true }, order)
    expect([...s.selected]).toEqual(['a'])
  })

  it('shift click selects the inclusive range from the anchor (either direction)', () => {
    const s = selectClick({ selected: new Set(['b']), anchor: 'b' }, 'd', { shift: true }, order)
    expect([...s.selected].sort()).toEqual(['b', 'c', 'd'])
    const up = selectClick({ selected: new Set(['d']), anchor: 'd' }, 'b', { shift: true }, order)
    expect([...up.selected].sort()).toEqual(['b', 'c', 'd'])
  })

  it('a plain click after a multi-selection resets to a single item', () => {
    const s = selectClick({ selected: new Set(['a', 'b', 'c']), anchor: 'a' }, 'e', {}, order)
    expect([...s.selected]).toEqual(['e'])
  })
})

describe('flattenVisible', () => {
  const node = (name: string, type: 'file' | 'dir'): TreeNode => ({ name, relPath: name, type })
  const children: Record<string, TreeNode[]> = {
    '': [node('src', 'dir'), node('readme', 'file')],
    src: [{ name: 'a.ts', relPath: 'src/a.ts', type: 'file' }]
  }

  it('lists only expanded folders in render order', () => {
    expect(flattenVisible(children, new Set())).toEqual(['src', 'readme'])
    expect(flattenVisible(children, new Set(['src']))).toEqual(['src', 'src/a.ts', 'readme'])
  })
})
