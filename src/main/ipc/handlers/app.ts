import { app } from 'electron'
import { z } from 'zod'
import { ok } from '@shared/result'
import { APP_NAME } from '@shared/constants'
import type { Registrar } from '../register'

export function registerAppHandlers(reg: Registrar): void {
  reg('app:getInfo', z.void(), () =>
    ok({ name: APP_NAME, version: app.getVersion(), platform: process.platform })
  )
}
