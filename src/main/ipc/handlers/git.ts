import { z } from 'zod'
import type { IpcMainInvokeEvent } from 'electron'
import { ok, err, type Err, type Result } from '@shared/result'
import * as gitService from '../../services/gitService'
import { rootFor } from '../../services/activeRoot'
import { pendingExecConfig, trustRepo, canonicalRoot } from '../../services/gitTrust'
import type { Registrar } from '../register'

const pathsSchema = z.object({ paths: z.array(z.string().max(4096)).max(5000) })
const commitSchema = z.object({ message: z.string().min(1).max(10000) })
const pushSchema = z.object({
  setUpstream: z.boolean().optional(),
  forceWithLease: z.boolean().optional()
})
const branchSchema = z.object({ name: z.string().min(1).max(255) })
const trustSchema = z.object({ root: z.string().min(1).max(4096) })

export function mapGitError(e: unknown): Err {
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

/** Runs a user-initiated git write / network operation, but only after the
 * repo's own .git/config has been checked for settings that make git execute a
 * command (filter drivers, sshCommand, credential helpers, …). A hostile repo
 * could otherwise run code the moment the user clicks Stage or Push. */
export async function gatedGit<T>(
  event: IpcMainInvokeEvent,
  op: (root: string) => Promise<Result<T>>
): Promise<Result<T>> {
  try {
    const root = rootFor(event)
    const entries = await pendingExecConfig(root)
    if (entries.length > 0) {
      return err(
        'UNTRUSTED_GIT_CONFIG',
        "This repo's git config runs commands: " + entries.map((e) => e.key).join(', '),
        { root, entries }
      )
    }
    return await op(root)
  } catch (e) {
    return mapGitError(e)
  }
}

export function registerGitHandlers(reg: Registrar): void {
  reg('git:status', z.void(), async (_req, event) => {
    try {
      return ok(await gitService.getStatus(rootFor(event)))
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:trustRepo', trustSchema, (req, event) => {
    // Only the window's own active repo can be trusted — never an arbitrary
    // path the renderer names.
    let active: string
    try {
      active = rootFor(event)
    } catch (e) {
      return mapGitError(e)
    }
    if (canonicalRoot(req.root) !== canonicalRoot(active)) {
      return err('VALIDATION', 'Not this window\'s active repository')
    }
    trustRepo(active)
    return ok(undefined)
  })

  reg('git:stage', pathsSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.stage(root, req.paths)
      return ok(undefined)
    })
  )

  reg('git:stageAll', z.void(), (_req, event) =>
    gatedGit(event, async (root) => {
      await gitService.stageAll(root)
      return ok(undefined)
    })
  )

  reg('git:unstage', pathsSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.unstage(root, req.paths)
      return ok(undefined)
    })
  )

  reg('git:discard', pathsSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.discard(root, req.paths)
      return ok(undefined)
    })
  )

  reg('git:commit', commitSchema, (req, event) =>
    gatedGit(event, async (root) => ok(await gitService.commit(root, req.message)))
  )

  reg('git:push', pushSchema, (req, event) =>
    gatedGit(event, async (root) => ok({ output: await gitService.push(root, req) }))
  )

  reg('git:pull', z.void(), (_req, event) =>
    gatedGit(event, async (root) => ok({ output: await gitService.pull(root) }))
  )

  reg('git:branches', z.void(), async (_req, event) => {
    try {
      return ok(await gitService.branches(rootFor(event)))
    } catch (e) {
      return mapGitError(e)
    }
  })

  reg('git:createBranch', branchSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.createBranch(root, req.name)
      return ok(undefined)
    })
  )

  reg('git:switchBranch', branchSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.switchBranch(root, req.name)
      return ok(undefined)
    })
  )

  reg('git:deleteBranch', branchSchema, (req, event) =>
    gatedGit(event, async (root) => {
      await gitService.deleteBranch(root, req.name)
      return ok(undefined)
    })
  )
}
