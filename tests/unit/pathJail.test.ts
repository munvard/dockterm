import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveInside, isInside, isRegularFile, JailViolation } from '@main/services/pathJail'

let root: string

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-jail-')))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.txt'), 'hi')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveInside', () => {
  it('resolves a relative path inside the root', () => {
    expect(resolveInside(root, 'src/a.txt')).toBe(join(root, 'src', 'a.txt'))
  })

  it('resolves a not-yet-existing path inside the root (for new files)', () => {
    expect(resolveInside(root, 'src/new/deep.txt')).toBe(join(root, 'src', 'new', 'deep.txt'))
  })

  it('rejects parent-directory traversal', () => {
    expect(() => resolveInside(root, '../secret.txt')).toThrow(JailViolation)
  })

  it('rejects an absolute path outside the root', () => {
    const outside = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd'
    expect(() => resolveInside(root, outside)).toThrow(JailViolation)
  })

  it('allows an absolute path that is already inside the root', () => {
    expect(resolveInside(root, join(root, 'src', 'a.txt'))).toBe(join(root, 'src', 'a.txt'))
  })

  it('rejects a symlink/junction that escapes the root', () => {
    let made = false
    try {
      symlinkSync(tmpdir(), join(root, 'escape'), 'junction')
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      expect(() => resolveInside(root, 'escape/whatever.txt')).toThrow(JailViolation)
    }
  })

  it('rejects a DANGLING symlink whose target is outside the root', () => {
    // The target doesn't exist, so a naive "nearest existing ancestor" walk
    // would treat the leaf as a plain not-yet-created file and let it through
    // — but fs.writeFile follows a dangling symlink and creates the target it
    // points to, so this must be rejected just like a resolvable escape.
    let made = false
    const outsideTarget = join(tmpdir(), `dockterm-jail-dangle-target-${process.pid}`)
    try {
      symlinkSync(outsideTarget, join(root, 'dangle-out'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      expect(() => resolveInside(root, 'dangle-out')).toThrow(JailViolation)
    }
  })

  it('allows a DANGLING symlink whose target is inside the root', () => {
    // A symlink to a not-yet-created sibling file within the project is a
    // normal, legitimate case (e.g. a build tool staging a link ahead of the
    // file it names) and must still resolve.
    let made = false
    const insideTarget = join(root, 'dangle-in-target.txt')
    try {
      symlinkSync(insideTarget, join(root, 'dangle-in'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      expect(resolveInside(root, 'dangle-in')).toBe(insideTarget)
    }
  })
})

describe('resolveInside: nested links', () => {
  const tryLink = (target: string, path: string): boolean => {
    try {
      symlinkSync(target, path)
      return true
    } catch {
      return false // no privilege to create links on this machine
    }
  }

  it('rejects leaf -> bridge/new-file where bridge -> outside and new-file does not exist', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-jail-out-')))
    try {
      if (!tryLink(outside, join(root, 'bridge'))) return
      if (!tryLink('bridge/new-file', join(root, 'leaf'))) return
      expect(() => resolveInside(root, 'leaf')).toThrow(JailViolation)
      expect(() => resolveInside(root, 'bridge/new-file')).toThrow(JailViolation)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('rejects an absolute two-link chain through a missing ancestor', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-jail-out2-')))
    try {
      if (!tryLink(outside, join(root, 'bridge2'))) return
      if (!tryLink(join(root, 'bridge2', 'missing-dir', 'file'), join(root, 'leaf2'))) return
      expect(() => resolveInside(root, 'leaf2')).toThrow(JailViolation)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('follows a ".." that comes after a link, the way the OS does', () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-jail-out3-')))
    try {
      mkdirSync(join(outside, 'deep'))
      if (!tryLink(join(outside, 'deep'), join(root, 'deeplink'))) return
      // deeplink/.. is `outside`, not the project root.
      expect(() => resolveInside(root, 'deeplink/../x')).toThrow(JailViolation)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('allows a two-link chain that stays inside the root', () => {
    mkdirSync(join(root, 'real-dir'), { recursive: true })
    if (!tryLink(join(root, 'real-dir'), join(root, 'in-bridge'))) return
    if (!tryLink('in-bridge/new-file', join(root, 'in-leaf'))) return
    expect(resolveInside(root, 'in-leaf')).toBe(join(root, 'real-dir', 'new-file'))
  })

  it('stops a link loop at the shared hop limit', () => {
    if (!tryLink('loop-b', join(root, 'loop-a'))) return
    if (!tryLink('loop-a', join(root, 'loop-b'))) return
    expect(() => resolveInside(root, 'loop-a')).toThrow(JailViolation)
  })
})

describe('isRegularFile', () => {
  it('is true for a real file', () => {
    expect(isRegularFile(join(root, 'src', 'a.txt'))).toBe(true)
  })

  it('is false for a directory', () => {
    expect(isRegularFile(join(root, 'src'))).toBe(false)
  })

  it('is false for a path that does not exist', () => {
    expect(isRegularFile(join(root, 'nope.txt'))).toBe(false)
  })

  it('is false for a symlink even when its target is a regular file', () => {
    let made = false
    try {
      symlinkSync(join(root, 'src', 'a.txt'), join(root, 'link-to-a.txt'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      expect(isRegularFile(join(root, 'link-to-a.txt'))).toBe(false)
    }
  })
})

describe('isInside', () => {
  it('treats the root as inside itself', () => {
    expect(isInside(root, root)).toBe(true)
  })
  it('rejects a sibling directory', () => {
    expect(isInside(join(root, 'a'), join(root, 'b'))).toBe(false)
  })
})
