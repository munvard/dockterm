import { app } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { ConfigStore } from './configStore'
import { MAX_RECENT_PROJECTS } from '@shared/constants'
import type { Settings, RecentProject, Checkpoint } from '@shared/types'

const checkpointSchema = z.object({
  hash: z.string(),
  branch: z.string(),
  label: z.string(),
  createdAt: z.number()
})

const workspaceSchema = z
  .object({
    tabs: z.array(z.object({ id: z.string(), title: z.string(), cwd: z.string() })),
    activeId: z.string()
  })
  .nullable()
  .default(null)

/** Per-section preference schemas. Every leaf has a default so old/partial
 * configs migrate forward by simply filling the gaps. */
const preference = {
  terminal: z
    .object({
      fontFamily: z.string().nullable().default(null),
      fontSize: z.number().int().min(8).max(40).default(13),
      cursorStyle: z.enum(['block', 'underline', 'bar']).default('block'),
      cursorBlink: z.boolean().default(true),
      renderer: z.enum(['auto', 'dom']).default('auto'),
      scrollback: z.number().int().min(500).max(100000).default(5000)
    })
    .default({}),
  editor: z.object({ fontSize: z.number().int().min(8).max(40).default(13) }).default({}),
  ui: z
    .object({
      accent: z.enum(['violet', 'blue', 'teal']).default('violet'),
      dockWidth: z.number().min(180).max(720).default(280),
      editorRatio: z.number().min(0.2).max(0.8).default(0.5),
      miniTermHeight: z.number().min(80).max(600).default(160),
      openPanel: z
        .enum(['files', 'git', 'review', 'mcp', 'skills', 'info', 'settings'])
        .nullable()
        .default(null),
      miniTermOpen: z.boolean().default(false),
      editorOpen: z.boolean().default(false)
    })
    .default({}),
  git: z
    .object({ beginnerMode: z.boolean().default(true), confirmDanger: z.boolean().default(true) })
    .default({}),
  claude: z.object({ readUserConfig: z.boolean().default(false) }).default({})
}

const settingsSchema = z.object({
  schemaVersion: z.number().default(1),
  lastProjectPath: z.string().nullable().default(null),
  recentProjects: z
    .array(z.object({ path: z.string(), name: z.string(), lastOpenedAt: z.number() }))
    .default([]),
  terminal: preference.terminal,
  editor: preference.editor,
  ui: preference.ui,
  git: preference.git,
  claude: preference.claude,
  workspace: workspaceSchema,
  checkpoints: z.record(checkpointSchema).default({})
})

/** Validates a settings patch from the renderer (preference sections only). */
export const settingsPatchSchema = z.object({
  terminal: preference.terminal.optional(),
  editor: preference.editor.optional(),
  ui: preference.ui.optional(),
  git: preference.git.optional(),
  claude: preference.claude.optional(),
  workspace: workspaceSchema.optional()
})

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({}) as Settings

let store: ConfigStore<Settings> | null = null

function getStore(): ConfigStore<Settings> {
  if (!store) {
    const path = join(app.getPath('userData'), 'dockterm-config.json')
    store = new ConfigStore<Settings>(
      path,
      DEFAULT_SETTINGS,
      (raw) => settingsSchema.parse(raw ?? {}) as Settings
    )
  }
  return store
}

export function getSettings(): Settings {
  return getStore().get()
}

export function applySettingsPatch(patch: Partial<Settings>): Settings {
  return getStore().update(patch)
}

export function addRecentProject(entry: RecentProject): Settings {
  const current = getStore().get()
  const recentProjects = [
    entry,
    ...current.recentProjects.filter((r) => r.path !== entry.path)
  ].slice(0, MAX_RECENT_PROJECTS)
  return getStore().update({ recentProjects, lastProjectPath: entry.path })
}

/** Clears the remembered project if it matches `path` — used when reopening it
 * fails so a stale/unwanted last project self-heals instead of reopening forever. */
export function clearLastProjectIfMatches(path: string): void {
  const store = getStore()
  if (store.get().lastProjectPath === path) {
    store.update({ lastProjectPath: null })
  }
}

export function getCheckpoint(projectPath: string): Checkpoint | null {
  return getStore().get().checkpoints[projectPath] ?? null
}

export function setCheckpoint(projectPath: string, checkpoint: Checkpoint): Settings {
  const checkpoints = { ...getStore().get().checkpoints, [projectPath]: checkpoint }
  return getStore().update({ checkpoints })
}

export function clearCheckpoint(projectPath: string): Settings {
  const checkpoints = { ...getStore().get().checkpoints }
  delete checkpoints[projectPath]
  return getStore().update({ checkpoints })
}
