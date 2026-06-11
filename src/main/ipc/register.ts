import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { err, type Result } from '@shared/result'
import { isTrustedSender } from '../security'
import { registerAppHandlers } from './handlers/app'
import { registerPtyHandlers } from './handlers/pty'

/**
 * A registrar binds one channel to one zod schema and one handler. Every call is:
 *   sender check -> schema validation -> handler -> typed Result (never a raw throw).
 * There is no generic dispatcher; each channel is an explicit verb.
 */
export type Registrar = <T>(
  channel: string,
  schema: z.ZodType<T>,
  handler: (req: T, event: IpcMainInvokeEvent) => Result<unknown> | Promise<Result<unknown>>
) => void

export function registerIpc(): void {
  const reg: Registrar = (channel, schema, handler) => {
    ipcMain.handle(channel, async (event, raw) => {
      if (!isTrustedSender(event.senderFrame?.url)) {
        return err('VALIDATION', 'Untrusted sender')
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        return err('VALIDATION', `Invalid payload for ${channel}`)
      }
      try {
        return await handler(parsed.data, event)
      } catch (e) {
        return err('UNKNOWN', e instanceof Error ? e.message : String(e))
      }
    })
  }

  registerAppHandlers(reg)
  registerPtyHandlers(reg)
}
