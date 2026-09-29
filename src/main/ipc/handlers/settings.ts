import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { ok } from '@shared/result'
import type { Settings } from '@shared/types'
import { getSettings, applySettingsPatch, settingsPatchSchema } from '../../services/settingsService'
import { syncOverlay } from '../../services/munuService'
import type { Registrar } from '../register'

/** `workspace` is per-window session state (which window's saved workspace
 * gets restored is decided by projectPath matching in the renderer, not by
 * which window happens to receive this broadcast) — every window's own
 * `useWorkspaceStore` is already its source of truth, so it never needs to
 * ride along in the shared settings:changed push. Stripped here rather than
 * left for each listener to ignore, since it's also the single largest field
 * (the whole persisted tab/layout tree) in a broadcast that already fires on
 * every preference change. */
function broadcast(settings: Settings): void {
  const shared = { ...settings, workspace: null }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('settings:changed', shared)
  }
}

export function registerSettingsHandlers(reg: Registrar): void {
  reg('settings:get', z.void(), () => ok(getSettings()))

  reg('settings:set', settingsPatchSchema, (patch) => {
    const next = applySettingsPatch(patch)
    broadcast(next)
    if (patch.munu) syncOverlay()
    return ok(next)
  })
}
