import { app, shell, BrowserWindow } from 'electron'
import { z } from 'zod'
import { ok } from '@shared/result'
import { APP_NAME } from '@shared/constants'
import { createWindow, isPrimaryWindow, applyZoomToAllWindows } from '../../window'
import { applySettingsPatch, getSettings } from '../../services/settingsService'
import type { Settings } from '@shared/types'
import type { Registrar } from '../register'

function broadcastSettings(next: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', next)
  }
}

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

  // Last-resort recovery from a poisoned persisted state. `hard` also forgets the
  // remembered project so the app reopens to a clean welcome screen.
  reg('app:recover', z.object({ hard: z.boolean() }), (req) => {
    const patch: Record<string, unknown> = { workspace: null }
    if (req.hard) patch.lastProjectPath = null
    applySettingsPatch(patch as never)
    return ok(undefined)
  })

  // Whole-UI zoom. Applies to every window, persists, and notifies renderers so
  // the settings UI stays in sync across windows.
  reg('ui:setZoom', z.object({ factor: z.number() }), (req) => {
    const zoom = Math.min(2, Math.max(0.7, Math.round(req.factor * 100) / 100))
    const s = getSettings()
    const next = applySettingsPatch({ ui: { ...s.ui, zoom } })
    applyZoomToAllWindows(zoom)
    broadcastSettings(next)
    return ok({ zoom })
  })
}
