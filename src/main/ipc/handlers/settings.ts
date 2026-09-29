import { z } from 'zod'
import { ok } from '@shared/result'
import { getSettings, applySettingsPatch, settingsPatchSchema } from '../../services/settingsService'
import { overlayPatchSchema, projectForOverlay } from '../../services/overlaySettings'
import { broadcastSettings } from '../../services/settingsBroadcast'
import { syncOverlay } from '../../services/munuService'
import type { Registrar } from '../register'

export function registerSettingsHandlers(reg: Registrar): void {
  reg('settings:get', z.void(), () => ok(getSettings()))

  reg('settings:set', settingsPatchSchema, (patch) => {
    const next = applySettingsPatch(patch)
    broadcastSettings(next)
    if (patch.munu) syncOverlay()
    return ok(next)
  })

  // Overlay only (see overlayChannels.ts): the munu / swarm subset, nothing else.
  reg('overlaySettings:get', z.void(), () => ok(projectForOverlay(getSettings())))

  reg('overlaySettings:set', overlayPatchSchema, (patch) => {
    const next = applySettingsPatch(patch)
    broadcastSettings(next)
    syncOverlay()
    return ok(projectForOverlay(next))
  })
}
