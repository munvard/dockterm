import { z } from 'zod'
import { ok, err, type Err } from '@shared/result'
import * as gitService from '../../services/gitService'
import { rootFor } from '../../services/activeRoot'
import type { Registrar } from '../register'

const pathsSchema = z.object({ paths: z.array(z.string().max(4096)).max(5000) })
const commitSchema = z.object({ message: z.string().min(1).max(10000) })
const pushSchema = z.object({
  setUpstream: z.boolean().optional(),
  forceWithLease: z.boolean().optional()
})
const branchSchema = z.object({ name: z.string().min(1).max(255) })

function mapGitError(e: unknown): Err {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (lower.includes('not a git repository')) return err('NOT_REPO', 'Not a Git repository')
  if (
    lower.includes('no upstream') ||
    lower.includes('set-upstream') ||
    lower.includes('no configured push destination')
  ) {
    return err('NO_UPSTREAM', msg)
  }
  if (
    lower.includes('authentication') ||
    lower.includes('could not read username') ||
    lower.includes('permission denied') ||
    lower.includes('terminal prompts disabled')
  ) {
    return err('AUTH_WAIT', msg)
  }
  if (lower.includes('conflict') || lower.includes('needs merge') || lower.includes('unmerged')) {
    return err('MERGE_CONFLICT', msg)
  }
  if (
    lower.includes('could not resolve host') ||
    lower.includes('failed to connect') ||
    lower.includes('timed out') ||
    lower.includes('network')
  ) {
    return err('NETWORK', msg)
  }
  // Keep the full message (not just the first line) for dubious-ownership: git's
  // own text includes the exact `git config --global --add safe.directory <path>`
  // fix, which used to get truncated away and misread as "not a repo".
  if (lower.includes('dubious ownership')) return err('GIT', msg.trim())
  return err('GIT', msg.split('\n')[0])
}

export function registerGitHandlers(reg: Registrar): void {
  reg('git:status', z.void(), async (_req, event) => {
    try {
      return ok(await gitService.getStatus(rootFor(event)))
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:stage', pathsSchema, async (req, event) => {
    try {
      await gitService.stage(rootFor(event), req.paths)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:stageAll', z.void(), async (_req, event) => {
    try {
      await gitService.stageAll(rootFor(event))
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:unstage', pathsSchema, async (req, event) => {
    try {
      await gitService.unstage(rootFor(event), req.paths)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:discard', pathsSchema, async (req, event) => {
    try {
      await gitService.discard(rootFor(event), req.paths)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:commit', commitSchema, async (req, event) => {
    try {
      return ok(await gitService.commit(rootFor(event), req.message))
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:push', pushSchema, async (req, event) => {
    try {
      return ok({ output: await gitService.push(rootFor(event), req) })
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:pull', z.void(), async (_req, event) => {
    try {
      return ok({ output: await gitService.pull(rootFor(event)) })
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:branches', z.void(), async (_req, event) => {
    try {
      return ok(await gitService.branches(rootFor(event)))
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:createBranch', branchSchema, async (req, event) => {
    try {
      await gitService.createBranch(rootFor(event), req.name)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:switchBranch', branchSchema, async (req, event) => {
    try {
      await gitService.switchBranch(rootFor(event), req.name)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:deleteBranch', branchSchema, async (req, event) => {
    try {
      await gitService.deleteBranch(rootFor(event), req.name)
      return ok(undefined)
    } catch (e) {
      return mapGitError(e)
    }
  })
}
