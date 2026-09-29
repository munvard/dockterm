import type { Result } from '@shared/result'
import {
  formatPathForClaude,
  isImagePath,
  isSafePath,
  pickImageMime,
  type PasteImageMime,
  type ComposerPlatform
} from '../chat/composerText'

/**
 * Image paste in TERMINAL mode: in a pane running Claude, pasting an image with
 * no text on the clipboard saves it to DockTerm's temp image dir and pastes the
 * file path, which Claude turns into `[Image #N]`. Text paste is untouched.
 */

export interface ImagePasteDeps {
  /** The three main-process calls, injected so this file needs no `window`. */
  saveImage: (data: Uint8Array, mime: PasteImageMime) => Promise<Result<{ path: string }>>
  readFiles: () => Promise<Result<{ paths: string[] }>>
  saveClipboardImage: () => Promise<Result<{ path: string | null }>>
  isClaude: () => Promise<boolean>
  /** User-paste semantics (xterm paste). */
  paste: (text: string) => void
  platform: ComposerPlatform
  warn: (message: string) => void
}

/** A DOM paste event carrying an image and no text. Returns whether it started handling it. */
export function handleImagePasteEvent(e: ClipboardEvent, deps: ImagePasteDeps): boolean {
  const dt = e.clipboardData
  if (!dt) return false
  const mime = pickImageMime(dt.getData('text/plain'), Array.from(dt.files))
  if (!mime) return false
  const file = Array.from(dt.files).find((f) => f.type === mime)
  if (!file) return false
  e.preventDefault()
  e.stopPropagation()
  void (async () => {
    if (!(await deps.isClaude())) return
    const res = await deps.saveImage(new Uint8Array(await file.arrayBuffer()), mime)
    if (!res.ok) return deps.warn(res.error.message)
    if (!(await deps.isClaude())) return
    deps.paste(formatPathForClaude(res.value.path, deps.platform))
  })()
  return true
}

/** Windows/Linux paste key with an empty text clipboard: look for image files, then an image. */
export async function pasteImageFromSystemClipboard(deps: ImagePasteDeps): Promise<void> {
  if (!(await deps.isClaude())) return
  const files = await deps.readFiles()
  const images = files.ok ? files.value.paths.filter((p) => isImagePath(p) && isSafePath(p)) : []
  if (images.length > 0) {
    if (!(await deps.isClaude())) return
    deps.paste(images.map((p) => formatPathForClaude(p, deps.platform)).join(' '))
    return
  }
  const saved = await deps.saveClipboardImage()
  if (!saved.ok) return deps.warn(saved.error.message)
  if (saved.value.path && (await deps.isClaude())) deps.paste(formatPathForClaude(saved.value.path, deps.platform))
}
