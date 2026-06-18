import { z } from 'zod'
import { ok, err } from '@shared/result'
import { readMcp, createMcpTemplate } from '../../services/claudeConfigService'
import { readSkills, readAgents, createSkill } from '../../services/skillsService'
import { getSettings } from '../../services/settingsService'
import { rootFor } from '../../services/activeRoot'
import type { Registrar } from '../register'

const templateEnum = z.enum(['brainstorming', 'ultraplan', 'review-changes', 'safe-commit', 'blank'])

export function registerClaudeHandlers(reg: Registrar): void {
  reg('claude:mcpRead', z.object({ includeUser: z.boolean() }), (req, event) => {
    // Double gate: the panel asks, and the user must have opted in via settings.
    const allowUser = req.includeUser && getSettings().claude.readUserConfig
    try {
      return ok(readMcp(rootFor(event), allowUser))
    } catch (e) {
      return err('IO', e instanceof Error ? e.message : 'Could not read MCP config')
    }
  })

  reg('claude:mcpCreateTemplate', z.void(), (_req, event) => {
    try {
      return ok({ relPath: createMcpTemplate(rootFor(event)) })
    } catch (e) {
      const exists =
        (e as NodeJS.ErrnoException).code === 'EEXIST' ||
        (e instanceof Error && e.message.includes('exists'))
      return err(exists ? 'EXISTS' : 'IO', e instanceof Error ? e.message : 'Could not create template')
    }
  })

  reg('claude:skillsRead', z.object({ includeUser: z.boolean() }), (req, event) => {
    const allowUser = req.includeUser && getSettings().claude.readUserConfig
    try {
      return ok(readSkills(rootFor(event), allowUser))
    } catch (e) {
      return err('IO', e instanceof Error ? e.message : 'Could not read skills')
    }
  })

  reg('claude:agentsRead', z.object({ includeUser: z.boolean() }), (req, event) => {
    const allowUser = req.includeUser && getSettings().claude.readUserConfig
    try {
      return ok(readAgents(rootFor(event), allowUser))
    } catch (e) {
      return err('IO', e instanceof Error ? e.message : 'Could not read agents')
    }
  })

  reg(
    'claude:skillCreate',
    z.object({
      name: z.string().min(1).max(100),
      kind: z.enum(['skill', 'command']),
      template: templateEnum
    }),
    (req, event) => {
      try {
        return ok({ relPath: createSkill(rootFor(event), req.name, req.kind, req.template) })
      } catch (e) {
        const exists = e instanceof Error && e.message.includes('exists')
        return err(exists ? 'EXISTS' : 'IO', e instanceof Error ? e.message : 'Could not create')
      }
    }
  )
}
