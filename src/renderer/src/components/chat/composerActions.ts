import { useComposeStore } from '../../state/useComposeStore'
import { useToastStore } from '../../state/useToastStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { composerPlatform } from '../../state/sendComposed'
import {
  absolutize,
  baseName,
  chunk,
  isImagePath,
  isSafePath,
  MAX_ATTACH_AT_ONCE,
  MAX_PASTE_IMAGE_BYTES,
  mergeClipboardPaths,
  pickImageMime,
  STAT_BATCH,
  type Attachment
} from './composerText'
import { findLeaf, type LeafNode } from '../../state/layout'

/** The composer's side effects that talk to main: turning paths, pasted bytes and
 * drops into attachments. Pure rules live in composerText.ts. */

function warn(message: string): void {
  useToastStore.getState().push(message, 'warning')
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** The pane's working directory (for `@relative` refs), or null. */
export function leafRoot(leafId: string): string | null {
  const ws = useWorkspaceStore.getState()
  const live = ws.paneCwd[leafId]
  if (live) return live
  for (const t of ws.tabs) {
    const leaf: LeafNode | null = findLeaf(t.layout, leafId)
    if (leaf) return leaf.cwd
  }
  return null
}

/** Existing paths become chips (image files as images, the rest as files or folders). */
export async function attachPaths(leafId: string, paths: string[]): Promise<number> {
  const clean = paths.filter(Boolean)
  let unique = [...new Set(clean.filter(isSafePath))]
  if (unique.length < new Set(clean).size) warn('Files with control characters in their name were skipped.')
  if (unique.length > MAX_ATTACH_AT_ONCE) {
    warn(`Only the first ${MAX_ATTACH_AT_ONCE} of ${unique.length} items were attached.`)
    unique = unique.slice(0, MAX_ATTACH_AT_ONCE)
  }
  if (unique.length === 0) return 0
  const items: Attachment[] = []
  // The request is capped at STAT_BATCH paths, so a large drop goes in batches.
  for (const batch of chunk(unique, STAT_BATCH)) {
    const res = await window.dockterm.invoke('chat:statPaths', { paths: batch, thumbs: true })
    if (!res.ok) {
      warn(res.error.message)
      break
    }
    for (const it of res.value.items) {
      items.push({
        id: newId(),
        kind: it.isDir ? 'dir' : isImagePath(it.path) ? 'image' : 'file',
        path: it.path,
        name: baseName(it.path),
        thumb: it.thumb
      })
    }
  }
  if (items.length < unique.length) warn('Some files could not be found.')
  if (items.length > 0) useComposeStore.getState().addAttachments(leafId, items)
  return items.length
}

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/** A pasted image (raw bytes): saved to DockTerm's temp dir so Claude can read it by path. */
export async function attachImageFile(leafId: string, file: File): Promise<boolean> {
  const mime = pickImageMime('', [file])
  if (!mime) return false
  if (file.size > MAX_PASTE_IMAGE_BYTES) {
    warn('Image is larger than 20 MB')
    return false
  }
  const res = await window.dockterm.invoke('chat:saveImage', {
    data: new Uint8Array(await file.arrayBuffer()),
    mime
  })
  if (!res.ok) {
    warn(res.error.message)
    return false
  }
  useComposeStore.getState().addAttachments(leafId, [
    {
      id: newId(),
      kind: 'image',
      path: res.value.path,
      name: `Pasted image.${EXT_FOR_MIME[mime]}`,
      thumb: URL.createObjectURL(file)
    }
  ])
  return true
}

/** Paperclip: multi-select open dialog. `directories` (Windows/Linux) picks folders instead. */
export async function pickAndAttach(leafId: string, directories = false): Promise<void> {
  const res = await window.dockterm.invoke('chat:pickFiles', directories ? { directories: true } : undefined)
  if (!res.ok) return warn(res.error.message)
  await attachPaths(leafId, res.value.paths)
}

/** Files copied in Finder / Explorer. Returns how many were attached (0 = none on the clipboard). */
export async function attachClipboardFiles(leafId: string, pasted: File[] = []): Promise<number> {
  const res = await window.dockterm.invoke('clipboard:readFiles', undefined)
  const os = res.ok ? res.value.paths : []
  // Windows yields a single path for a multi-file copy: fall back to the pasted files' own paths.
  const own = pasted.length > os.length ? pasted.map((f) => window.dockterm.pathForFile(f)) : []
  const paths = mergeClipboardPaths(os, own, pasted.length)
  if (paths.length === 0) return 0
  return attachPaths(leafId, paths)
}

/** Everything a drop can carry: DockTerm's own payload, or real files from the OS / the file tree. */
export function pathsFromDrop(dt: DataTransfer, root: string | null): string[] {
  const platform = composerPlatform()
  const out: string[] = []
  const internal = dt.getData('application/x-dockterm')
  if (internal) {
    try {
      const { path } = JSON.parse(internal) as { path?: string }
      if (path) out.push(absolutize(root, path, platform))
    } catch {
      // malformed payload
    }
  }
  for (const f of Array.from(dt.files)) {
    const p = window.dockterm.pathForFile(f)
    if (p) out.push(p)
  }
  return out
}

export function dropHasAttachable(dt: DataTransfer): boolean {
  return dt.types.includes('Files') || dt.types.includes('application/x-dockterm')
}
