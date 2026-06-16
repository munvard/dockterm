import { existsSync } from 'node:fs'
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { ok, err } from '@shared/result'
import { inspectProject, initGitRepo } from '../../services/projectService'
import {
  addRecentProject,
  getSettings,
  clearLastProjectIfMatches
} from '../../services/settingsService'
import { retargetWatcher } from '../../services/watcherService'
import { setActiveRoot } from '../../services/activeRoot'
import { resolveProjectRoot } from '../../services/projectResolve'
import type { Registrar } from '../register'

const pathSchema = z.object({ path: z.string().min(1).max(4096) })

export function registerProjectHandlers(reg: Registrar): void {
  reg('project:openDialog', z.void(), async (_req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) {
      return ok({ canceled: true as const })
    }
    return ok({ path: result.filePaths[0] })
  })

  reg('project:open', pathSchema, async (req, event) => {
    try {
      const info = await inspectProject(req.path)
      setActiveRoot(event.sender.id, info.path)
      addRecentProject({ path: info.path, name: info.name, lastOpenedAt: Date.now() })
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) retargetWatcher(win, info.path)
      return ok(info)
    } catch (e) {
      // If the remembered project can no longer be opened, stop reopening it.
      clearLastProjectIfMatches(req.path)
      return err('NOT_FOUND', e instanceof Error ? e.message : 'Cannot open project')
    }
  })

  reg('project:setActiveRoot', pathSchema, (req, event) => {
    // `req.path` may be any terminal cwd; the dock targets its project root.
    const root = resolveProjectRoot(req.path)
    setActiveRoot(event.sender.id, root)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) retargetWatcher(win, root)
    return ok(undefined)
  })

  reg('project:getRecent', z.void(), () =>
    ok(getSettings().recentProjects.filter((r) => existsSync(r.path)))
  )

  reg('project:gitInit', pathSchema, async (req) => {
    try {
      return ok(await initGitRepo(req.path))
    } catch (e) {
      return err('GIT', e instanceof Error ? e.message : 'git init failed')
    }
  })
}
