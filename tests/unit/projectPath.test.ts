import { describe, it, expect } from 'vitest'
import { toRelProjectPath } from '../../src/renderer/src/components/terminal/projectPath'

describe('toRelProjectPath', () => {
  const root = '/home/me/proj'

  it('strips a leading ./', () => {
    expect(toRelProjectPath('./src/app.ts', root)).toBe('src/app.ts')
  })

  it('makes an absolute path inside the root project-relative', () => {
    expect(toRelProjectPath('/home/me/proj/src/app.ts', root)).toBe('src/app.ts')
  })

  it('rejects absolute paths outside the open project (can\'t be jailed)', () => {
    expect(toRelProjectPath('/etc/passwd', root)).toBeNull()
    expect(toRelProjectPath('/home/me/other/x.ts', root)).toBeNull()
  })

  it('rejects the root itself', () => {
    expect(toRelProjectPath('/home/me/proj', root)).toBeNull()
  })

  it('rejects Windows-absolute paths', () => {
    expect(toRelProjectPath('C:/Windows/system32/x.dll', null)).toBeNull()
  })

  it('normalizes backslashes and keeps a plain relative path', () => {
    expect(toRelProjectPath('src\\components\\App.tsx', root)).toBe('src/components/App.tsx')
    expect(toRelProjectPath('docs/guide.md', null)).toBe('docs/guide.md')
  })

  it('tolerates a trailing slash on the root', () => {
    expect(toRelProjectPath('/home/me/proj/a.ts', '/home/me/proj/')).toBe('a.ts')
  })
})
