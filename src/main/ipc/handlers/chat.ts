import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { ok, err } from '@shared/result'
import { saveImageSchema, validateImage } from '../../services/chatImageCore'
import { alwaysAllowedDirs, describePaths, readClipboardFilePaths, saveChatImage } from '../../services/chatFiles'
import { grantPaths, isPathAllowed } from '../../services/pathGrants'
import { isTrustedSender } from '../../security'
import { roleOf } from '../windowRoles'
import type { Registrar } from '../register'

export function registerChatHandlers(reg: Registrar): void {
  reg('chat:saveImage', saveImageSchema, (req) => {
    try {
      return ok({ path: saveChatImage(req.data, req.mime) })
    } catch (e) {
      return err('IO', e instanceof Error ? e.message : 'Could not save the image')
    }
  })

  // The clipboard image as a PNG in the same temp dir (Windows/Linux terminal
  // paste has no DOM paste event to read the bytes from). null when none.
  reg('clipboard:saveImage', z.void(), () => {
    try {
      const img = clipboard.readImage()
      if (img.isEmpty()) return ok({ path: null })
      const png = img.toPNG()
      const bad = validateImage('image/png', png.byteLength)
      if (bad) return err('TOO_LARGE', bad)
      return ok({ path: saveChatImage(png, 'image/png') })
    } catch (e) {
      return err('IO', e instanceof Error ? e.message : 'Could not read the clipboard image')
    }
  })

  reg('clipboard:readFiles', z.void(), (_req, event) => {
    const paths = readClipboardFilePaths()
    grantPaths(event.sender.id, paths)
    return ok({ paths })
  })

  // A real drop: the preload script reports the path of a genuine File object (webUtils),
  // which a compromised renderer cannot forge, so the path becomes attachable.
  ipcMain.on('chat:grantPath', (event, p: unknown) => {
    if (!isTrustedSender(event.senderFrame?.url) || roleOf(event.sender.id) !== 'main') return
    if (typeof p === 'string') grantPaths(event.sender.id, [p])
  })

  reg(
    'chat:statPaths',
    z.object({ paths: z.array(z.string().max(4096)).max(100), thumbs: z.boolean() }),
    (req, event) => {
      // Only what the user handed over this session, or lives inside a project root / the image dir.
      const dirs = alwaysAllowedDirs(event.sender.id)
      const allowed = req.paths.filter((p) => isPathAllowed(event.sender.id, p, dirs))
      return ok({ items: describePaths(allowed, req.thumbs) })
    }
  )

  reg('chat:pickFiles', z.object({ directories: z.boolean().optional() }).optional(), async (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // Windows/Linux dialogs cannot mix files and folders; macOS can. There, folders have their own button.
    const properties: Electron.OpenDialogOptions['properties'] =
      process.platform === 'darwin'
        ? ['openFile', 'openDirectory', 'multiSelections']
        : req?.directories
          ? ['openDirectory', 'multiSelections']
          : ['openFile', 'multiSelections']
    const res = win
      ? await dialog.showOpenDialog(win, { properties })
      : await dialog.showOpenDialog({ properties })
    const paths = res.canceled ? [] : res.filePaths
    grantPaths(event.sender.id, paths)
    return ok({ paths })
  })
}
