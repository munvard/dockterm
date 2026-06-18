import { promises as fs } from 'node:fs'
import { shell } from 'electron'
import { resolveInside } from './pathJail'
import { IGNORED_ENTRIES, MAX_EDIT_FILE_BYTES, MAX_TREE_ENTRIES } from '@shared/constants'
import type { TreeNode, ReadFileResult, WriteFileResult } from '@shared/ipc'

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

export async function readFile(root: string, relPath: string): Promise<ReadFileResult> {
  const abs = resolveInside(root, relPath)
  const stat = await fs.stat(abs)
  if (stat.size > MAX_EDIT_FILE_BYTES) return { kind: 'too-large', size: stat.size }
  const buffer = await fs.readFile(abs)
  if (isBinary(buffer)) return { kind: 'binary', size: stat.size }
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
  await fs.writeFile(abs, content, 'utf8')
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

export async function rename(root: string, fromRel: string, toRel: string): Promise<void> {
  await fs.rename(resolveInside(root, fromRel), resolveInside(root, toRel))
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
