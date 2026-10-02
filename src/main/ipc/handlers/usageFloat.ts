import { z } from 'zod'
import { ok } from '@shared/result'
import { getSettings, applySettingsPatch } from '../../services/settingsService'
import { broadcastSettings } from '../../services/settingsBroadcast'
import { getUsageHistory } from '../../services/usageHistoryService'
import { floatViewPatchSchema, usageFloatView } from '../../usageFloatCore'
import { syncUsageWidget } from '../../usageFloatWindow'
import type { Registrar } from '../register'

export function registerUsageFloatHandlers(reg: Registrar): void {
  reg('usageHistory:get', z.object({ hours: z.number().finite().min(1).max(168).optional() }).optional(), (req) =>
    ok(getUsageHistory(req?.hours))
  )

  reg('usageFloat:get', z.void(), () => ok(usageFloatView(getSettings())))

  reg('usageFloat:set', floatViewPatchSchema, (patch) => {
    const next = applySettingsPatch({ usage: { float: patch } })
    broadcastSettings(next)
    syncUsageWidget()
    return ok(usageFloatView(next))
  })

  reg('usageFloat:close', z.void(), () => {
    broadcastSettings(applySettingsPatch({ usage: { float: { enabled: false } } }))
    syncUsageWidget()
    return ok(undefined)
  })
}
