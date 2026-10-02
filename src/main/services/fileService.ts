import { constants as fsConstants, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { shell } from 'electron'
import { resolveInside, isRegularFile } from './pathJail'
import { IGNORED_ENTRIES, MAX_EDIT_FILE_BYTES, MAX_TREE_ENTRIES } from '@shared/constants'
import type { TreeNode, DirListing, ReadFileResult, WriteFileResult } from '@shared/ipc'
import { duplicateName } from '@shared/fileNames'

/** One level of children for `relPath` ('' = project root). Dirs first, then files. */
export async function readTree(root: string, relPath: string): Promise<TreeNode[]> {
  const abs = relPath ? resolveInside(root, relPath) : root
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (IGNORED_ENTRIES.includes(entry.name)) continue
    if (entry.isSymbolicLink()) continue
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
    nodes.push({ name: entry.name, relPath: childRel, type: entry.isDirectory() ? 'dir' : 'file' })
    if (nodes.length >= MAX_TREE_ENTRIES) break
  }
  nodes.sort((a, b) =>
    a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)
  )
  return nodes
}

const STAT_LANES = 48

/**
 * One folder for the explorer: the same entries as readTree (symlinks never
 * listed) with size and mtime, built-in ignored entries only when `showIgnored`,
 * and a count of what was left out past MAX_TREE_ENTRIES. Unsorted: the renderer
 * sorts by the user's chosen order.
 */
export async function readDir(root: string, relPath: string, showIgnored: boolean): Promise<DirListing> {
  const abs = relPath ? resolveInside(root, relPath) : root
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const nodes: TreeNode[] = []
  let used = 0
  for (const entry of entries) {
    used++
    const ignored = IGNORED_ENTRIES.includes(entry.name)
    if (ignored && !showIgnored) continue
    if (entry.isSymbolicLink()) continue
    const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
    nodes.push({ name: entry.name, relPath: childRel, type: entry.isDirectory() ? 'dir' : 'file', ignored })
    if (nodes.length >= MAX_TREE_ENTRIES) break
  }
  let next = 0
  const lane = async (): Promise<void> => {
    while (next < nodes.length) {
      const node = nodes[next++]
      try {
        const st = await fs.lstat(join(abs, node.name))
        node.size = node.type === 'file' ? st.size : undefined
        node.mtimeMs = st.mtimeMs
      } catch {
        // vanished between readdir and lstat: leave it unstatted
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(STAT_LANES, nodes.length) }, lane))
  return { entries: nodes, more: Math.max(0, entries.length - used) }
}

/** Copy a file or folder next to itself as "name copy.ext". Returns the new relPath. */
export async function duplicate(root: string, relPath: string): Promise<string> {
  const { parent, name } = splitRelPath(relPath)
  const parentAbs = parent ? resolveInside(root, parent) : root
  const fromAbs = resolveInside(root, relPath)
  const taken = new Set(await fs.readdir(parentAbs))
  const copyName = duplicateName(name, taken)
  await fs.cp(fromAbs, join(parentAbs, copyName), {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true
  })
  return parent ? `${parent}/${copyName}` : copyName
}

const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_DIRS = 4000

/**
 * Recursively find files/dirs whose name matches `query` (case-insensitive),
 * pruning IGNORED_ENTRIES + symlinks and staying inside `root`. Bounded on both
 * results and directories visited so a huge tree can't hang the search.
 */
export async function searchTree(root: string, query: string): Promise<TreeNode[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: TreeNode[] = []
  let dirsVisited = 0

  const walk = async (relPath: string): Promise<void> => {
    if (out.length >= MAX_SEARCH_RESULTS || dirsVisited >= MAX_SEARCH_DIRS) return
    dirsVisited++
    const abs = relPath ? resolveInside(root, relPath) : root
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      return
    }
    const subdirs: string[] = []
    for (const entry of entries) {
      if (IGNORED_ENTRIES.includes(entry.name)) continue
      if (entry.isSymbolicLink()) continue
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name
      const isDir = entry.isDirectory()
      if (entry.name.toLowerCase().includes(q)) {
        out.push({ name: entry.name, relPath: childRel, type: isDir ? 'dir' : 'file' })
        if (out.length >= MAX_SEARCH_RESULTS) return
      }
      if (isDir) subdirs.push(childRel)
    }
    for (const d of subdirs) {
      if (out.length >= MAX_SEARCH_RESULTS || dirsVisited >= MAX_SEARCH_DIRS) return
      await walk(d)
    }
  }

  await walk('')
  // Files first, then folders; each alphabetical by path — predictable results.
  out.sort((a, b) =>
    a.type !== b.type ? (a.type === 'file' ? -1 : 1) : a.relPath.localeCompare(b.relPath)
  )
  return out.slice(0, MAX_SEARCH_RESULTS)
}

/** True if `buffer` is not valid UTF-8. Decoding in fatal mode is the reliable
 * check — a byte-scan heuristic misses many invalid sequences that `toString`
 * would otherwise silently replace with U+FFFD, corrupting the file the
 * moment it's opened (and again, permanently, the moment it's saved back). */
function isInvalidUtf8(buffer: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return false
  } catch {
    return true
  }
}

export async function readFile(root: string, relPath: string): Promise<ReadFileResult> {
  const abs = resolveInside(root, relPath)
  const stat = await fs.stat(abs)
  if (!isRegularFile(abs)) return { kind: 'binary', size: stat.size }
  if (stat.size > MAX_EDIT_FILE_BYTES) return { kind: 'too-large', size: stat.size }
  const buffer = await fs.readFile(abs)
  // Not valid text we can safely round-trip: treat it like a binary file so
  // the editor never opens (and risks re-saving a corrupted copy of) it.
  if (isBinary(buffer) || isInvalidUtf8(buffer)) return { kind: 'binary', size: stat.size }
  return { kind: 'text', content: buffer.toString('utf8'), mtimeMs: stat.mtimeMs }
}

export async function writeFile(
  root: string,
  relPath: string,
  content: string,
  expectedMtimeMs: number | null
): Promise<WriteFileResult> {
  const abs = resolveInside(root, relPath)
  if (expectedMtimeMs !== null) {
    try {
      const stat = await fs.stat(abs)
      if (Math.abs(stat.mtimeMs - expectedMtimeMs) > 1) {
        return { kind: 'conflict', mtimeMs: stat.mtimeMs }
      }
    } catch {
      // file vanished — fall through and recreate it
    }
  }
  // Write-then-rename: a crash or power loss mid-write leaves the original
  // file untouched instead of a truncated/corrupted one, since rename onto an
  // existing path is atomic on the same filesystem (always true here — the
  // temp file is a sibling of the target).
  // The temp file is new, so it would get default permissions: carry the old
  // mode over (a saved script stays executable), and refuse a read-only file
  // that an in-place write would also have refused.
  let mode: number | null = null
  try {
    mode = (await fs.stat(abs)).mode & 0o7777
    await fs.access(abs, fsConstants.W_OK)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const tmp = `${abs}.dockterm-tmp-${process.pid}-${Date.now()}`
  try {
    await fs.writeFile(tmp, content, 'utf8')
    if (mode !== null && process.platform !== 'win32') await fs.chmod(tmp, mode)
    await fs.rename(tmp, abs)
  } catch (e) {
    await fs.unlink(tmp).catch(() => {})
    // Windows refuses to replace a file another program holds open (an editor,
    // an indexer, antivirus); an in-place write still works there.
    const code = (e as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && mode !== null && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
      await fs.writeFile(abs, content, 'utf8')
    } else {
      throw e
    }
  }
  const stat = await fs.stat(abs)
  return { kind: 'ok', mtimeMs: stat.mtimeMs }
}

export async function createFile(root: string, relPath: string): Promise<void> {
  const abs = resolveInside(root, relPath)
  await fs.writeFile(abs, '', { flag: 'wx' })
}

export async function createDir(root: string, relPath: string): Promise<void> {
  const abs = resolveInside(root, relPath)
  await fs.mkdir(abs)
}

/** Split a renderer-supplied relative path into its parent dir and the basename
 * exactly as the caller spelled it. resolveInside canonicalizes to the spelling
 * already on disk, so a case-only rename ("Foo.txt" -> "foo.txt") would resolve
 * both sides to the same string and silently do nothing. */
export function splitRelPath(relPath: string): { parent: string; name: string } {
  const p = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const i = p.lastIndexOf('/')
  const name = i < 0 ? p : p.slice(i + 1)
  if (!name || name === '.' || name === '..') throw new Error('Invalid name')
  return { parent: i < 0 ? '' : p.slice(0, i), name }
}

/** A rename whose destination differs from the source only by letter case. */
export function isCaseOnlyChange(fromName: string, toName: string): boolean {
  return fromName !== toName && fromName.toLowerCase() === toName.toLowerCase()
}

export async function rename(root: string, fromRel: string, toRel: string): Promise<void> {
  const fromAbs = resolveInside(root, fromRel)
  const { parent, name } = splitRelPath(toRel)
  const toAbs = join(resolveInside(root, parent), name)
  if (fromAbs === toAbs) return
  // fs.rename silently overwrites an existing destination (POSIX semantics), so
  // refuse that. The one exception is a pure case change of the SAME file on a
  // case-insensitive filesystem, where the destination "exists" because it is the
  // source: go through a unique sibling name so the new spelling really lands.
  const [fromStat, destStat] = await Promise.all([
    fs.lstat(fromAbs),
    fs.lstat(toAbs).catch(() => null)
  ])
  if (destStat) {
    const sameFile = destStat.ino === fromStat.ino && destStat.dev === fromStat.dev
    if (!(sameFile && dirname(fromAbs) === dirname(toAbs) && isCaseOnlyChange(basename(fromAbs), name))) {
      throw new Error('A file or folder with that name already exists')
    }
    const tmp = join(dirname(fromAbs), `.dockterm-rename-${process.pid}-${Date.now()}`)
    await fs.rename(fromAbs, tmp)
    try {
      await fs.rename(tmp, toAbs)
    } catch (e) {
      await fs.rename(tmp, fromAbs).catch(() => {})
      throw e
    }
    return
  }
  await fs.rename(fromAbs, toAbs)
}

export async function trash(root: string, relPath: string): Promise<void> {
  await shell.trashItem(resolveInside(root, relPath))
}

export function reveal(root: string, relPath: string): void {
  shell.showItemInFolder(resolveInside(root, relPath))
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}
const MAX_DATAURL_BYTES = 25 * 1024 * 1024

/** Read a (jailed) file as a base64 data URL — used to preview images. */
export async function readDataUrl(
  root: string,
  relPath: string
): Promise<{ dataUrl: string; size: number }> {
  const abs = resolveInside(root, relPath)
  if (!isRegularFile(abs)) throw new Error('Not a regular file')
  const stat = await fs.stat(abs)
  if (stat.size > MAX_DATAURL_BYTES) throw new Error('File is too large to preview')
  const buffer = await fs.readFile(abs)
  const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
  const mime = IMAGE_MIME[ext] ?? 'application/octet-stream'
  return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, size: stat.size }
}

/** Open a (jailed) file in the OS default application. */
export async function openPath(root: string, relPath: string): Promise<void> {
  await shell.openPath(resolveInside(root, relPath))
}

function isBinary(buffer: Buffer): boolean {
  const len = Math.min(buffer.length, 8000)
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true
  }
  return false
}
