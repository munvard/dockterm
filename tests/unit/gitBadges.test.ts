import { describe, expect, it } from 'vitest'
import { buildGitBadges } from '../../src/renderer/src/components/files/gitBadges'
import type { GitFileEntry, GitStatusView } from '../../src/shared/types'

const entry = (path: string, status: GitFileEntry['status'], staged = false): GitFileEntry => ({ path, status, staged })
const view = (p: Partial<GitStatusView>): GitStatusView => ({
  repoState: 'ok',
  branch: 'main',
  upstream: null,
  staged: [],
  unstaged: [],
  untracked: [],
  conflicted: [],
  clean: false,
  ...p
})

describe('buildGitBadges', () => {
  it('badges a changed file and every folder above it', () => {
    const m = buildGitBadges(view({ unstaged: [entry('src/a/b.ts', 'modified')] }))
    expect(m.get('src/a/b.ts')?.letter).toBe('M')
    expect(m.get('src/a')?.cls).toBe('mod')
    expect(m.get('src')?.cls).toBe('mod')
    expect(m.isFolderMark('src')).toBe(true)
    expect(m.isFolderMark('src/a/b.ts')).toBe(false)
    expect(m.get('docs')).toBeNull()
  })
  it('the strongest state wins for a folder and for a file staged and changed', () => {
    const m = buildGitBadges(
      view({
        staged: [entry('x/new.ts', 'added', true)],
        unstaged: [entry('x/old.ts', 'modified')],
        untracked: [entry('x/tmp.ts', 'untracked')],
        conflicted: [entry('y/c.ts', 'conflicted')]
      })
    )
    expect(m.get('x')?.cls).toBe('mod')
    expect(m.get('y')?.cls).toBe('con')
  })
  it('an untracked folder entry badges everything inside it', () => {
    const m = buildGitBadges(view({ untracked: [entry('newdir/', 'untracked')] }))
    expect(m.get('newdir')?.letter).toBe('U')
    expect(m.get('newdir/deep/file.ts')?.letter).toBe('U')
    expect(m.get('newdir2/file.ts')).toBeNull()
  })
  it('no repo and no status give an empty map', () => {
    expect(buildGitBadges(null).get('a')).toBeNull()
    expect(buildGitBadges(view({ repoState: 'not-repo', unstaged: [entry('a', 'modified')] })).get('a')).toBeNull()
  })
})
