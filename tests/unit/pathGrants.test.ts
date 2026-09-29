import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearGrants, grantPaths, isPathAllowed } from '@main/services/pathGrants'
import { saveImageSchema, MAX_IMAGE_BYTES } from '@main/services/chatImageCore'

const dirs: string[] = []
function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'dt-grant-')))
  dirs.push(d)
  return d
}
afterEach(() => {
  clearGrants(1)
  clearGrants(2)
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('chat:statPaths allow-list (sol-A 4)', () => {
  it('refuses an arbitrary path outside every root and grant', () => {
    const root = tmp()
    const outside = tmp()
    writeFileSync(join(outside, 'secret.png'), 'x')
    expect(isPathAllowed(1, join(outside, 'secret.png'), [root])).toBe(false)
  })

  it('allows paths inside a project root, not siblings', () => {
    const root = tmp()
    writeFileSync(join(root, 'a.png'), 'x')
    expect(isPathAllowed(1, join(root, 'a.png'), [root])).toBe(true)
    expect(isPathAllowed(1, join(root, '..', 'other.png'), [root])).toBe(false)
  })

  it('a symlink inside the root that points outside is refused', () => {
    const root = tmp()
    const outside = tmp()
    writeFileSync(join(outside, 'secret.png'), 'x')
    symlinkSync(join(outside, 'secret.png'), join(root, 'link.png'))
    expect(isPathAllowed(1, join(root, 'link.png'), [root])).toBe(false)
  })

  it('allows a path the user handed over (dialog / clipboard / drop), only for that window', () => {
    const outside = tmp()
    const f = join(outside, 'dropped.png')
    writeFileSync(f, 'x')
    expect(isPathAllowed(1, f, [])).toBe(false)
    grantPaths(1, [f])
    expect(isPathAllowed(1, f, [])).toBe(true)
    expect(isPathAllowed(2, f, [])).toBe(false)
    clearGrants(1)
    expect(isPathAllowed(1, f, [])).toBe(false)
  })

  it('a grant for a folder does not open its contents', () => {
    const outside = tmp()
    mkdirSync(join(outside, 'sub'))
    writeFileSync(join(outside, 'sub', 'a.png'), 'x')
    grantPaths(1, [join(outside, 'sub')])
    expect(isPathAllowed(1, join(outside, 'sub'), [])).toBe(true)
    expect(isPathAllowed(1, join(outside, 'sub', 'a.png'), [])).toBe(false)
  })

  it('ignores junk grants', () => {
    grantPaths(1, ['', 'x'.repeat(5000)])
    expect(isPathAllowed(1, '/', [])).toBe(false)
  })
})

describe('chat:saveImage size (sol-A 8)', () => {
  it('rejects a typed array over 20 MB in the schema, before any copy', () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    expect(saveImageSchema.safeParse({ data: big, mime: 'image/png' }).success).toBe(false)
    expect(saveImageSchema.safeParse({ data: new Uint8Array(10), mime: 'image/png' }).success).toBe(true)
  })
})
