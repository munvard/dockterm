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
    tabs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        layout: z.any(),
        focusedLeafId: z.string()
      })
    ),
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
      scrollback: z.number().int().min(500).max(100000).default(5000),
      shellIntegration: z.boolean().default(true),
      /** Show the Start-Claude / Resume buttons in the pane controls. */
      claudeButtons: z.boolean().default(true),
      /** Copy automatically when text is selected (off → use ⌘C / the toolbar). */
      copyOnSelect: z.boolean().default(false),
      /** Show the floating "Send to Claude / Copy" toolbar on selection. */
      selectionToolbar: z.boolean().default(true),
      /** Restore each terminal's scrollback (read-only) after a full quit. */
      restoreScrollback: z.boolean().default(true),
      /** Floating live "Changes" overlay listing files Claude touched. */
      changesOverlay: z.boolean().default(true),
      /** ⌘⇧⏎ opens a roomy Compose editor for long prompts. */
      composeOverlay: z.boolean().default(true),
      /** Hover a file path in the terminal to preview it (image/markdown/code). */
      filePreviews: z.boolean().default(true),
      /** Run Claude Code in its fullscreen TUI (flicker-free, alternate screen) vs
       * the default inline rendering, which uses the terminal's own scrollback so
       * scrolling feels native and Claude's `/tui` setting is respected. Off = inline. */
      claudeFullscreen: z.boolean().default(false)
    })
    .default({}),
  sessionHistory: z
    .object({
      enabled: z.boolean().default(true),
      side: z.enum(['left', 'right']).default('right'),
      /** Show the checkpoints as a floating, movable/resizable card vs a side panel. */
      floating: z.boolean().default(false)
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
        .enum(['files', 'git', 'review', 'mcp', 'skills', 'agents', 'activity', 'usage', 'info', 'settings'])
        .nullable()
        .default(null),
      miniTermOpen: z.boolean().default(false),
      editorOpen: z.boolean().default(false),
      zoom: z.number().min(0.7).max(2).default(1.1)
    })
    .default({}),
  git: z
    .object({ beginnerMode: z.boolean().default(true), confirmDanger: z.boolean().default(true) })
    .default({}),
  claude: z
    .object({
      readUserConfig: z.boolean().default(false),
      paths: z
        .object({
          skills: z.string().default(''),
          commands: z.string().default(''),
          agents: z.string().default(''),
          mcpConfig: z.string().default('')
        })
        .default({})
    })
    .default({}),
  update: z
    .object({
      checkAutomatically: z.boolean().default(true),
      dismissedVersion: z.string().nullable().default(null),
      remindAfter: z.number().default(0)
    })
    .default({}),
  usage: z
    .object({
      enabled: z.boolean().default(true),
      plan: z.enum(['auto', 'pro', 'max5x', 'max20x']).default('auto')
    })
    .default({}),
  agentActivity: z
    .object({
      enabled: z.boolean().default(true),
      streamOutput: z.boolean().default(true),
      swarm: z.boolean().default(true),
      pill: z.boolean().default(true),
      sounds: z.boolean().default(true),
      notifications: z.boolean().default(true)
    })
    .default({}),
  munu: z
    .object({
      enabled: z.boolean().default(true),
      overlay: z.boolean().default(true),
      sounds: z.boolean().default(true),
      attention: z.boolean().default(true),
      keepAwake: z.boolean().default(true),
      notifications: z.boolean().default(true),
      size: z.number().int().min(36).max(120).default(56),
      character: z.enum(['munu', 'nvurd', 'guru', 'adanana']).default('munu'),
      pinned: z.boolean().default(false),
      position: z.object({ x: z.number(), y: z.number() }).nullable().default(null)
    })
    .default({})
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
  update: preference.update,
  usage: preference.usage,
  agentActivity: preference.agentActivity,
  sessionHistory: preference.sessionHistory,
  munu: preference.munu,
  theme: z.string().default('dockterm-graphite'),
  /** Free-form scratchpad shown in the top-bar notes popover; auto-saved. */
  notes: z.string().max(200_000).default(''),
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
  update: preference.update.optional(),
  usage: preference.usage.optional(),
  agentActivity: preference.agentActivity.optional(),
  sessionHistory: preference.sessionHistory.optional(),
  munu: preference.munu.optional(),
  theme: z.string().optional(),
  notes: z.string().max(200_000).optional(),
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
