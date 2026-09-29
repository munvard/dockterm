import { BrowserWindow, clipboard, dialog } from 'electron'
import { z } from 'zod'
import { ok, err } from '@shared/result'
import { saveImageSchema, validateImage } from '../../services/chatImageCore'
import { readClipboardFilePaths, saveChatImage } from '../../services/chatFiles'
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

  reg('clipboard:readFiles', z.void(), () => ok({ paths: readClipboardFilePaths() }))

  reg('chat:pickFiles', z.void(), async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // Windows/Linux dialogs cannot mix files and folders; macOS can.
    const properties: Electron.OpenDialogOptions['properties'] =
      process.platform === 'darwin'
        ? ['openFile', 'openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections']
    const res = win
      ? await dialog.showOpenDialog(win, { properties })
      : await dialog.showOpenDialog({ properties })
    return ok({ paths: res.canceled ? [] : res.filePaths })
  })
}
