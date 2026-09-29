import { app, clipboard, nativeImage } from 'electron'
import { realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { knownRootsOf } from './activeRoot'
import {
  classifyPaths,
  keepExistingAbsolute,
  parseFileNameW,
  parseNSFilenames,
  parseUriList
} from './clipboardFilesCore'
import { IMAGE_DIR_NAME, MAX_IMAGE_BYTES, sweepOldImages, writeImage, type ImageMime } from './chatImageCore'

export function imageDir(): string {
  return join(app.getPath('temp'), IMAGE_DIR_NAME)
}

export function saveChatImage(data: string | Uint8Array, mime: ImageMime): string {
  return writeImage(imageDir(), data, mime)
}

export function cleanupOldChatImages(): void {
  sweepOldImages(imageDir())
}

/** Absolute paths of files copied in Finder / Explorer / a Linux file manager. */
export function readClipboardFilePaths(): string[] {
  let paths: string[] = []
  try {
    if (process.platform === 'darwin') {
      const many = clipboard.readBuffer('NSFilenamesPboardType').toString('utf8')
      paths = parseNSFilenames(many)
      if (paths.length === 0) paths = parseUriList(clipboard.readBuffer('public.file-url').toString('utf8'))
    } else if (process.platform === 'win32') {
      paths = parseFileNameW(clipboard.readBuffer('FileNameW'))
    } else {
      paths = parseUriList(clipboard.read('text/uri-list'))
      if (paths.length === 0) paths = parseUriList(clipboard.readText())
    }
  } catch {
    paths = []
  }
  return keepExistingAbsolute(paths)
}

const THUMB_WIDTH = 360

/** A small JPEG data URL for the attachment chip, or undefined (unsupported type, too big, unreadable). */
function thumbnailFor(path: string): string | undefined {
  try {
    const st = statSync(realpathSync(path))
    if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return undefined
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) return undefined
    const { width } = img.getSize()
    const small = width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH }) : img
    return `data:image/jpeg;base64,${small.toJPEG(80).toString('base64')}`
  } catch {
    return undefined
  }
}

/** For the composer's attachment tray: which paths exist, folder or not, and an image thumbnail. */
export function describePaths(
  paths: string[],
  thumbs: boolean
): { path: string; isDir: boolean; thumb?: string }[] {
  return classifyPaths(paths).map((p) => ({
    ...p,
    thumb: thumbs && !p.isDir && /\.(png|jpe?g)$/i.test(p.path) ? thumbnailFor(p.path) : undefined
  }))
}

/** Directories whose contents may always be described: the window's project roots and the temp image dir. */
export function alwaysAllowedDirs(webContentsId: number): string[] {
  return [...knownRootsOf(webContentsId), imageDir()]
}
