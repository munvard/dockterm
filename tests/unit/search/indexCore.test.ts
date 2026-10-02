import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { IndexerCore, isTooBroadToIndex } from '../../../src/main/search/indexCore'

let root = ''
let core: IndexerCore

const put = (rel: string, text = 'x'): void => {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, text)
}
const find = (q: string, includeIgnored = false): string[] =>
  core.query(q, { includeIgnored, kinds: 'files', limit: 100 }).results.hits.map((h) => h.relPath)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dockterm-index-'))
  put('src/app.ts')
  put('src/deep/very/nested/target.ts')
  put('README.md')
  put('.env.example')
  put('node_modules/left-pad/index.js')
  put('node_modules/@scope/pkg/deep/needle.js')
  put('dist/bundle.js')
  put('.git/config')
  put('.gitignore', 'build/\n*.log\n')
  put('build/out.js')
  put('debug.log')
  core = new IndexerCore(root, () => undefined)
})
afterEach(() => {
  core.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('IndexerCore', () => {
  it('indexes normal files and finds dotfiles, hides ignored ones', async () => {
    await core.start()
    expect(find('app.ts')).toEqual(['src/app.ts'])
    expect(find('target')).toEqual(['src/deep/very/nested/target.ts'])
    expect(find('.env')).toEqual(['.env.example'])
    expect(find('index.js')).toEqual([])
    expect(find('out.js')).toEqual([])
    expect(find('debug.log')).toEqual([])
  })

  it('finds node_modules, gitignored and .git files only with include ignored', async () => {
    await core.start()
    expect(find('needle', true)).toEqual(['node_modules/@scope/pkg/deep/needle.js'])
    expect(find('bundle', true)).toEqual(['dist/bundle.js'])
    expect(find('out.js', true)[0]).toBe('build/out.js')
    expect(find('config', true)).toContain('.git/config')
    expect(find('needle', false)).toEqual([])
  })

  it('reports phases and counts', async () => {
    const done = core.start()
    await done
    const s = core.status()
    expect(s.state).toBe('ready')
    expect(s.ignoredDone).toBe(true)
    expect(s.files).toBeGreaterThan(8)
    expect(s.truncated).toBe(false)
  })

  it('never follows symlinks', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'dockterm-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 's')
    symlinkSync(outside, join(root, 'link'))
    symlinkSync(join(outside, 'secret.txt'), join(root, 'secretlink.txt'))
    await core.start()
    expect(find('secret', true)).toEqual([])
    rmSync(outside, { recursive: true, force: true })
  })

  it('follows watch events without a rewalk', async () => {
    await core.start()
    put('src/new-file.ts')
    core.applyWatch([{ type: 'add', relPath: 'src/new-file.ts' }])
    expect(find('new-file')).toEqual(['src/new-file.ts'])
    core.applyWatch([{ type: 'unlink', relPath: 'src/app.ts' }])
    expect(find('app.ts')).toEqual([])
    core.applyWatch([{ type: 'unlinkDir', relPath: 'src/deep' }])
    expect(find('target')).toEqual([])
  })

  it('walks a folder that appears later (addDir)', async () => {
    await core.start()
    put('feature/a.ts')
    put('feature/sub/b.ts')
    core.applyWatch([{ type: 'addDir', relPath: 'feature' }])
    await new Promise((r) => setTimeout(r, 100))
    expect(find('b.ts')).toEqual(['feature/sub/b.ts'])
  })

  it('flags a watched file inside an ignored folder as ignored', async () => {
    await core.start()
    core.applyWatch([{ type: 'add', relPath: 'node_modules/x/new.js' }])
    expect(find('new.js')).toEqual([])
    expect(find('new.js', true)).toEqual(['node_modules/x/new.js'])
  })

  it('stops at the entry cap and says so', async () => {
    const small = new IndexerCore(root, () => undefined, 5)
    await small.start()
    expect(small.status().truncated).toBe(true)
    expect(small.status().files + small.status().dirs).toBeLessThanOrEqual(5)
    small.dispose()
  })

  it('content candidates honour globs and the ignored toggle', async () => {
    await core.start()
    const all = core.contentCandidates({ include: '', exclude: '', includeIgnored: false })
    expect(all).toContain('src/app.ts')
    expect(all).not.toContain('node_modules/left-pad/index.js')
    expect(core.contentCandidates({ include: '*.md', exclude: '', includeIgnored: false })).toEqual(['README.md'])
    expect(core.contentCandidates({ include: '', exclude: 'src', includeIgnored: false })).not.toContain('src/app.ts')
    expect(core.contentCandidates({ include: '*.js', exclude: '', includeIgnored: true })).toContain(
      'node_modules/@scope/pkg/deep/needle.js'
    )
  })

  it('refresh picks up changes made outside the watcher', async () => {
    await core.start()
    put('late/added.ts')
    await core.refresh()
    expect(find('added.ts')).toEqual(['late/added.ts'])
  })
})

describe('isTooBroadToIndex', () => {
  it('refuses the home folder, its parents and a drive root', () => {
    expect(isTooBroadToIndex(homedir())).toBe(true)
    expect(isTooBroadToIndex('/')).toBe(true)
    expect(isTooBroadToIndex(join(homedir(), '..'))).toBe(true)
    expect(isTooBroadToIndex(join(homedir(), 'some-project'))).toBe(false)
  })
  it('on Windows a differently cased spelling of the home folder is still refused', () => {
    expect(isTooBroadToIndex(homedir().toUpperCase(), 'win32')).toBe(true)
    expect(isTooBroadToIndex(homedir().toLowerCase(), 'win32')).toBe(true)
    expect(isTooBroadToIndex(join(homedir(), 'Some-Project').toUpperCase(), 'win32')).toBe(false)
  })
})

describe('applyWatch refuses paths outside the project', () => {
  it('ignores parent, absolute and drive-letter paths and does not walk outside', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'dockterm-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'x')
    try {
      await core.start()
      core.applyWatch([
        { type: 'add', relPath: '../x.ts' },
        { type: 'add', relPath: 'src/../../y.ts' },
        { type: 'addDir', relPath: '..' },
        { type: 'addDir', relPath: outside },
        { type: 'add', relPath: 'C:/x/z.ts' },
        { type: 'add', relPath: '..\\w.ts' },
        { type: 'add', relPath: 'src/fine.ts' }
      ])
      await core.whenIdle()
      const all = core.query('', { includeIgnored: true, kinds: 'both', limit: 500 }).results.hits.map((h) => h.relPath)
      expect(all.some((p) => p.includes('..') || p.includes('secret') || /^[A-Za-z]:/.test(p) || p.startsWith('/'))).toBe(false)
      expect(all).toContain('src/fine.ts')
      expect(find('x.ts')).toEqual([])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
