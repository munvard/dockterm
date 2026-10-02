import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { err, type Result } from '@shared/result'
import { isTrustedSender } from '../security'
import { isChannelAllowedForRole } from './overlayChannels'
import { roleOf } from './windowRoles'
import { registerAppHandlers } from './handlers/app'
import { registerPtyHandlers } from './handlers/pty'
import { registerSettingsHandlers } from './handlers/settings'
import { registerProjectHandlers } from './handlers/project'
import { registerFsHandlers } from './handlers/fs'
import { registerSearchHandlers } from './handlers/search'
import { registerGitHandlers } from './handlers/git'
import { registerReviewHandlers } from './handlers/review'
import { registerClaudeHandlers } from './handlers/claude'
import { registerInfoHandlers } from './handlers/info'
import { registerMunuHandlers } from './handlers/munu'
import { registerChatHandlers } from './handlers/chat'
import { registerUsageFloatHandlers } from './handlers/usageFloat'

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
      if (!isChannelAllowedForRole(channel, roleOf(event.sender.id))) {
        return err('VALIDATION', 'Channel not available to this window')
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
  registerSettingsHandlers(reg)
  registerProjectHandlers(reg)
  registerFsHandlers(reg)
  registerSearchHandlers(reg)
  registerGitHandlers(reg)
  registerReviewHandlers(reg)
  registerClaudeHandlers(reg)
  registerInfoHandlers(reg)
  registerMunuHandlers(reg)
  registerChatHandlers(reg)
  registerUsageFloatHandlers(reg)
}
