import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bufferNamespace, getWindowProject, paneKey, setWindowProject } from '@main/services/windowNamespace'
import { setActiveRoot, clearActiveRoot } from '@main/services/activeRoot'

describe('paneKey', () => {
  it('differs per window for the same leafId', () => {
    expect(paneKey(1, 'leaf')).not.toBe(paneKey(2, 'leaf'))
    expect(paneKey(1, 'leaf')).toBe(paneKey(1, 'leaf'))
  })

  it('cannot be forged by a leafId that contains the separator and another window id', () => {
    expect(paneKey(1, '2\0leaf')).not.toBe(paneKey(12, 'leaf'))
    expect(paneKey(1, '2\0leaf')).not.toBe(paneKey(1, 'leaf'))
  })
})

describe('bufferNamespace', () => {
  const made: string[] = []
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const proj = (): string => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-ns-')))
    made.push(d)
    return d
  }

  it('is the canonical path of the project the window opened, so it survives a restart', () => {
    const p = proj()
    setWindowProject(9101, p)
    const first = bufferNamespace(9101)
    // "restart": a new window (new webContents id) opens the same project
    setWindowProject(9102, p)
    expect(bufferNamespace(9102)).toBe(first)
  })

  it('two windows on different projects get different namespaces', () => {
    setWindowProject(9103, proj())
    setWindowProject(9104, proj())
    expect(bufferNamespace(9103)).not.toBe(bufferNamespace(9104))
  })

  it('a symlink to the project resolves to the same namespace', () => {
    const p = proj()
    const link = join(tmpdir(), `dockterm-ns-link-${process.pid}`)
    try {
      symlinkSync(p, link)
    } catch {
      return
    }
    made.push(link)
    setWindowProject(9105, p)
    setWindowProject(9106, link)
    expect(bufferNamespace(9106)).toBe(bufferNamespace(9105))
  })

  it('does NOT follow the focused pane: moving the active root leaves the namespace alone', () => {
    const p = proj()
    mkdirSync(join(p, 'sub'))
    setWindowProject(9107, p)
    setActiveRoot(9107, join(p, 'sub'))
    expect(bufferNamespace(9107)).toBe(bufferNamespace(9107))
    setActiveRoot(9107, tmpdir())
    expect(bufferNamespace(9107)).toBe(canonicalOf(p))
    clearActiveRoot(9107)
    expect(bufferNamespace(9107)).toBe(canonicalOf(p))
  })

  it('opening another project in the same window switches the namespace', () => {
    const a = proj()
    const b = proj()
    setWindowProject(9108, a)
    setWindowProject(9108, b)
    expect(bufferNamespace(9108)).toBe(canonicalOf(b))
  })

  it('remembers the project as the user passed it, for the primary handoff (minor 4)', () => {
    const p = proj()
    setWindowProject(9109, p)
    expect(getWindowProject(9109)).toBe(p)
    expect(getWindowProject(9198)).toBeNull()
  })

  it('throws for a window that never opened a project', () => {
    expect(() => bufferNamespace(9199)).toThrow()
  })
})

const canonicalOf = (p: string): string => (process.platform === 'win32' ? realpathSync(p).toLowerCase() : realpathSync(p))
