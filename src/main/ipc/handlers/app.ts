import { app, shell, BrowserWindow, clipboard } from 'electron'
import os from 'node:os'
import { existsSync, statSync } from 'node:fs'
import { z } from 'zod'
import { ok } from '@shared/result'
import { APP_NAME } from '@shared/constants'
import { createWindow, isPrimaryWindow, applyZoomToAllWindows } from '../../window'
import { applySettingsPatch, getSettings } from '../../services/settingsService'
import {
  checkForUpdate,
  downloadAndInstall,
  snoozeUpdate,
  skipUpdate
} from '../../services/updateChecker'
import { getUsageSnapshot } from '../../services/usageService'
import { getAgentActivity } from '../../services/agentActivityService'
import { getSessionHistory, getConversation } from '../../services/sessionHistoryService'
import type { Settings } from '@shared/types'
import type { Registrar } from '../register'

/** `workspace` is per-window session state, never shared state — see the same
 * strip in ipc/handlers/settings.ts's broadcast(). */
function broadcastSettings(next: Settings): void {
  const shared = { ...next, workspace: null }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', shared)
  }
}

/** Windows build number out of os.release() ("10.0.22621" -> 22621). Xterm's
 * conpty reflow/scrollback heuristics (windowsPty) key off this. */
function windowsBuildNumber(release: string): number | undefined {
  const m = /^\d+\.\d+\.(\d+)/.exec(release)
  return m ? parseInt(m[1], 10) : undefined
}

export function registerAppHandlers(reg: Registrar): void {
  reg('app:getInfo', z.void(), () =>
    ok({
      name: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      home: app.getPath('home'),
      windowsBuildNumber:
        process.platform === 'win32' ? windowsBuildNumber(os.release()) : undefined
    })
  )

  reg('app:openExternal', z.object({ url: z.string().max(2048) }), (req) => {
    if (/^https?:\/\//i.test(req.url)) void shell.openExternal(req.url)
    return ok(undefined)
  })

  reg('clipboard:read', z.void(), () => ok(clipboard.readText()))

  reg('usage:get', z.void(), async () => ok(await getUsageSnapshot()))

  reg('activity:get', z.void(), async () => ok(await getAgentActivity()))

  reg(
    'session:getHistory',
    z.object({
      cwd: z.string().max(4096),
      sample: z.array(z.string().max(400)).max(80),
      leafId: z.string().max(128),
      claudeActive: z.boolean()
    }),
    async (req) => ok(await getSessionHistory(req.cwd, req.sample, req.leafId, req.claudeActive))
  )

  reg(
    'reading:get',
    z.object({
      cwd: z.string().max(4096),
      sample: z.array(z.string().max(400)).max(80),
      leafId: z.string().max(128),
      claudeActive: z.boolean(),
      sinceRevision: z.number().int().min(0).finite().optional()
    }),
    async (req) =>
      ok(await getConversation(req.cwd, req.sample, req.leafId, req.claudeActive, req.sinceRevision))
  )

  reg('update:check', z.void(), async () => {
    const found = await checkForUpdate(true)
    return ok({ upToDate: !found })
  })

  reg('update:download', z.void(), () => {
    void downloadAndInstall()
    return ok(undefined)
  })

  reg('update:snooze', z.object({ hours: z.number().min(0).max(720) }), (req) => {
    snoozeUpdate(req.hours)
    return ok(undefined)
  })

  reg('update:skip', z.object({ version: z.string().max(40) }), (req) => {
    skipUpdate(req.version)
    return ok(undefined)
  })

  reg('window:new', z.object({ path: z.string().min(1).max(4096) }).optional(), (req) => {
    const win = createWindow()
    // "Open in new window": the fresh window starts on that project. It has no
    // terminals yet, so the renderer's project-switch guard stays silent.
    if (req?.path && existsSync(req.path) && statSync(req.path).isDirectory()) {
      const path = req.path
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed()) win.webContents.send('project:openRequested', { path })
      })
    }
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
