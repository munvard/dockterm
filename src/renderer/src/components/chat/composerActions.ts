import { useComposeStore } from '../../state/useComposeStore'
import { useToastStore } from '../../state/useToastStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { composerPlatform } from '../../state/sendComposed'
import { absolutize, baseName, isImagePath, pickImageMime, type Attachment } from './composerText'
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
  const unique = [...new Set(paths.filter(Boolean))]
  if (unique.length === 0) return 0
  const res = await window.dockterm.invoke('chat:statPaths', { paths: unique, thumbs: true })
  if (!res.ok) {
    warn(res.error.message)
    return 0
  }
  const items: Attachment[] = res.value.items.map((it) => ({
    id: newId(),
    kind: it.isDir ? 'dir' : isImagePath(it.path) ? 'image' : 'file',
    path: it.path,
    name: baseName(it.path),
    thumb: it.thumb
  }))
  if (items.length < unique.length) warn('Some files could not be found.')
  useComposeStore.getState().addAttachments(leafId, items)
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

/** Paperclip: multi-select open dialog. */
export async function pickAndAttach(leafId: string): Promise<void> {
  const res = await window.dockterm.invoke('chat:pickFiles', undefined)
  if (!res.ok) return warn(res.error.message)
  await attachPaths(leafId, res.value.paths)
}

/** Files copied in Finder / Explorer. Returns how many were attached (0 = none on the clipboard). */
export async function attachClipboardFiles(leafId: string): Promise<number> {
  const res = await window.dockterm.invoke('clipboard:readFiles', undefined)
  if (!res.ok || res.value.paths.length === 0) return 0
  return attachPaths(leafId, res.value.paths)
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
