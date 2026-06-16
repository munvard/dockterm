import { z } from 'zod'
import { ok, err } from '@shared/result'
import * as gitService from '../../services/gitService'
import { createCheckpoint, getCheckpointStatus } from '../../services/checkpointService'
import { getCheckpoint } from '../../services/settingsService'
import { rootFor } from '../../services/activeRoot'
import { getSessionChanges } from '../../services/watcherService'
import type { Registrar } from '../register'

const baseSchema = z.enum(['working', 'session', 'checkpoint'])
const listSchema = z.object({ base: baseSchema })
const diffSchema = z.object({ base: baseSchema, relPath: z.string().min(1).max(4096) })
const createSchema = z.object({ label: z.string().max(200) })

function checkpointHash(root: string): string | null {
  try {
    return getCheckpoint(root)?.hash ?? null
  } catch {
    return null
  }
}

export function registerReviewHandlers(reg: Registrar): void {
  reg('review:list', listSchema, async (req, event) => {
    const root = rootFor(event)
    try {
      return ok(
        await gitService.changedSince(root, req.base, checkpointHash(root), getSessionChanges(event.sender.id))
      )
    } catch (e) {
      return err('GIT', e instanceof Error ? e.message : 'Could not list changes')
    }
  })

  reg('review:diffFile', diffSchema, async (req, event) => {
    const root = rootFor(event)
    try {
      return ok(await gitService.diffFile(root, req.base, checkpointHash(root), req.relPath))
    } catch (e) {
      return err('GIT', e instanceof Error ? e.message : 'Could not build diff')
    }
  })

  reg('checkpoint:create', createSchema, async (req, event) => {
    try {
      return ok(await createCheckpoint(rootFor(event), req.label))
    } catch (e) {
      return err('GIT', e instanceof Error ? e.message : 'Could not create checkpoint')
    }
  })

  reg('checkpoint:get', z.void(), async (_req, event) => {
    try {
      return ok(await getCheckpointStatus(rootFor(event)))
    } catch (e) {
      return err('GIT', e instanceof Error ? e.message : 'Could not read checkpoint')
    }
  })
}
