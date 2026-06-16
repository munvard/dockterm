import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { resolveProjectRoot } from '@main/services/projectResolve'

/** Deterministic existence check over a fixed set of paths (no real fs). */
function fakeExists(present: string[]): (p: string) => boolean {
  const set = new Set(present)
  return (p: string) => set.has(p)
}

const root = join('/tmp', 'proj')
const deep = join(root, 'src', 'a', 'b')

describe('resolveProjectRoot', () => {
  it('returns the nearest ancestor containing .git', () => {
    expect(resolveProjectRoot(deep, fakeExists([join(root, '.git')]))).toBe(root)
  })

  it('prefers a closer .git over a farther one', () => {
    const inner = join(root, 'src')
    expect(
      resolveProjectRoot(deep, fakeExists([join(root, '.git'), join(inner, '.git')]))
    ).toBe(inner)
  })

  it('falls back to the nearest manifest when no .git exists', () => {
    expect(resolveProjectRoot(deep, fakeExists([join(root, 'package.json')]))).toBe(root)
  })

  it('falls back to the cwd itself when nothing is found', () => {
    expect(resolveProjectRoot(deep, fakeExists([]))).toBe(deep)
  })
})
