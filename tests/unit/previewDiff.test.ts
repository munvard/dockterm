import { describe, it, expect } from 'vitest'
import { buildPreviewDiff } from '../../src/renderer/src/components/terminal/previewDiff'

describe('buildPreviewDiff', () => {
  it('emits the added and removed lines of a change', () => {
    const out = buildPreviewDiff('a\nb\nc\n', 'a\nB\nc\n')
    expect(out.some((l) => l.type === 'del' && l.text === 'b')).toBe(true)
    expect(out.some((l) => l.type === 'add' && l.text === 'B')).toBe(true)
    // The unchanged 'a' and 'c' are not emitted (changes-only view).
    expect(out.some((l) => l.type !== 'gap' && l.text === 'a')).toBe(false)
  })

  it('inserts a gap between non-adjacent hunks', () => {
    const out = buildPreviewDiff('a\nb\nc\nd\ne\nf\n', 'A\nb\nc\nd\ne\nF\n')
    expect(out.some((l) => l.type === 'gap')).toBe(true)
  })

  it('returns an empty array for identical input', () => {
    expect(buildPreviewDiff('x\ny\n', 'x\ny\n')).toEqual([])
  })

  it('caps the output length', () => {
    const big = Array.from({ length: 500 }, (_, i) => `add${i}`).join('\n')
    expect(buildPreviewDiff('', big, 50).length).toBeLessThanOrEqual(50)
  })
})
