import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { hasIgnoredSegment } from '@main/services/watcherService'

describe('hasIgnoredSegment', () => {
  const root = join('/Users', 'me', 'projects', 'app')

  it('ignores node_modules under the root', () => {
    expect(hasIgnoredSegment(root, join(root, 'node_modules', 'x'))).toBe(true)
  })

  it('ignores a nested build dir under the root', () => {
    expect(hasIgnoredSegment(root, join(root, 'packages', 'x', 'dist', 'index.js'))).toBe(true)
  })

  it('does NOT ignore files when the PROJECT ITSELF sits inside a dir named like an ignored entry', () => {
    // The project root's own ancestor is literally called "build" — only
    // segments AT OR BELOW the root should count, not ones above it.
    const rootUnderBuild = join('/Users', 'me', 'build', 'app')
    expect(hasIgnoredSegment(rootUnderBuild, join(rootUnderBuild, 'src', 'index.ts'))).toBe(false)
  })

  it('does not ignore an ordinary source file', () => {
    expect(hasIgnoredSegment(root, join(root, 'src', 'index.ts'))).toBe(false)
  })

  it('is false for the root itself', () => {
    expect(hasIgnoredSegment(root, root)).toBe(false)
  })
})
