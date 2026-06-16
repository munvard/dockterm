import { app, shell } from 'electron'
import { z } from 'zod'
import { ok } from '@shared/result'
import { APP_NAME } from '@shared/constants'
import { createWindow, isPrimaryWindow } from '../../window'
import type { Registrar } from '../register'

export function registerAppHandlers(reg: Registrar): void {
  reg('app:getInfo', z.void(), () =>
    ok({ name: APP_NAME, version: app.getVersion(), platform: process.platform })
  )

  reg('app:openExternal', z.object({ url: z.string().max(2048) }), (req) => {
    if (/^https?:\/\//i.test(req.url)) void shell.openExternal(req.url)
    return ok(undefined)
  })

  reg('window:new', z.void(), () => {
    createWindow()
    return ok(undefined)
  })

  reg('window:isPrimary', z.void(), (_req, event) => ok(isPrimaryWindow(event.sender.id)))
}
