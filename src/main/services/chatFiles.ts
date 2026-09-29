import { app, clipboard } from 'electron'
import { join } from 'node:path'
import {
  keepExistingAbsolute,
  parseFileNameW,
  parseNSFilenames,
  parseUriList
} from './clipboardFilesCore'
import { IMAGE_DIR_NAME, sweepOldImages, writeImage, type ImageMime } from './chatImageCore'

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
