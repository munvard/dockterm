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
  createdAt: z.number().finite()
})

const workspaceBase = z
  .object({
    tabs: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        layout: z.any(),
        focusedLeafId: z.string()
      })
    ),
    activeId: z.string(),
    /** The project root this workspace was saved for. Restoring it into a
     * DIFFERENT project used to bleed one project's terminal tabs into another
     * (e.g. a second window opening a different repo would restore the first
     * project's tabs). Optional so an older persisted file (with no projectPath)
     * still migrates forward — the renderer treats a missing value as "don't
     * restore" rather than "restore regardless". */
    projectPath: z.string().optional()
  })
  .nullable()

const workspaceSchema = workspaceBase.default(null)

const usageMetric = z.enum(['fiveHour', 'sevenDay', 'context', 'cost'])
const usageStyle = z.enum(['percent', 'bar', 'ring', 'graph'])

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
      claudeFullscreen: z.boolean().default(false),
      /** Reading comfort: line spacing (xterm multiplier). */
      lineHeight: z.number().min(1).max(2).default(1.15),
      /** Reading comfort: character spacing (xterm px). */
      letterSpacing: z.number().min(0).max(2).default(0),
      /** Reading comfort: inner padding around the terminal content (px). */
      padding: z.number().int().min(4).max(28).default(8),
      /** Reading comfort: centered reading-column cap on wide screens. */
      readingWidth: z.enum(['off', 'narrow', 'medium', 'wide']).default('off'),
      /** macOS only: Option+key sends Meta instead of the layout's own
       * character. Off by default (German/French/etc. layouts need Option for
       * @{}[]|~\). */
      macOptionIsMeta: z.boolean().default(false)
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
  reading: z
    .object({
      /** Show the Reading view as a floating, movable/resizable card vs a side panel. */
      floating: z.boolean().default(false)
    })
    .default({}),
  files: z
    .object({
      sortBy: z.enum(['name', 'type', 'modified', 'size']).default('name'),
      sortDesc: z.boolean().default(false),
      foldersFirst: z.boolean().default(true),
      showHidden: z.boolean().default(true),
      showIgnored: z.boolean().default(false),
      /** Quick Open and Find in files: also search ignored and hidden folders (node_modules, build output, .git). */
      searchIgnored: z.boolean().default(false)
    })
    .default({}),
  chat: z
    .object({
      /** What view a pane starts in. 'terminal' keeps DockTerm terminal-first. */
      defaultMode: z.enum(['terminal', 'chat']).default('terminal')
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
        .enum(['files', 'search', 'git', 'review', 'mcp', 'skills', 'agents', 'activity', 'usage', 'info', 'settings'])
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
      remindAfter: z.number().finite().default(0)
    })
    .default({}),
  usage: z
    .object({
      enabled: z.boolean().default(true),
      plan: z.enum(['auto', 'pro', 'max5x', 'max20x']).default('auto'),
      source: z.enum(['claude', 'local']).default('claude'),
      captureEnabled: z.boolean().default(true),
      captureWithoutStatusLine: z.boolean().default(false),
      pill: z
        .object({
          show: z.array(usageMetric).max(4).default(['fiveHour']),
          style: usageStyle.default('percent'),
          showReset: z.boolean().default(true),
          warnAt: z.number().min(0).max(100).default(75),
          critAt: z.number().min(0).max(100).default(90)
        })
        .default({}),
      float: z
        .object({
          enabled: z.boolean().default(false),
          x: z.number().finite().nullable().default(null),
          y: z.number().finite().nullable().default(null),
          w: z.number().min(120).max(1200).default(260),
          h: z.number().min(60).max(900).default(120),
          alwaysOnTop: z.boolean().default(true),
          opacity: z.number().min(0.3).max(1).default(1),
          show: z.array(usageMetric).max(4).default(['fiveHour', 'sevenDay']),
          style: usageStyle.default('percent'),
          showReset: z.boolean().default(true)
        })
        .default({})
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
      position: z
        .object({ x: z.number().finite(), y: z.number().finite() })
        .nullable()
        .default(null)
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
  reading: preference.reading,
  chat: preference.chat,
  files: preference.files,
  munu: preference.munu,
  theme: z.string().default('dockterm-graphite'),
  /** Free-form scratchpad shown in the top-bar notes popover; auto-saved. */
  notes: z.string().max(200_000).default(''),
  workspace: workspaceSchema,
  checkpoints: z.record(checkpointSchema).default({})
})

/** The same shape with every `.default()` removed and every object field
 * optional, recursively: a patch validates only what it names. Parsing a patch
 * with the default-bearing schemas used to fill every omitted field, so a
 * partial section silently reset its siblings to factory values. */
function toPatchSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodDefault) return toPatchSchema(schema._def.innerType)
  if (schema instanceof z.ZodOptional) return toPatchSchema(schema.unwrap()).optional()
  if (schema instanceof z.ZodNullable) return toPatchSchema(schema.unwrap()).nullable()
  if (schema instanceof z.ZodObject) {
    const shape: Record<string, z.ZodTypeAny> = {}
    for (const [k, v] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      shape[k] = toPatchSchema(v).optional()
    }
    return z.object(shape)
  }
  return schema
}

/** Validates a settings patch from the renderer (preference sections only). No
 * field is defaulted: what the patch does not name is left as it is. The merged
 * result is validated again against the full {@link settingsSchema}. */
export const settingsPatchSchema = z.object({
  terminal: toPatchSchema(preference.terminal).optional(),
  editor: toPatchSchema(preference.editor).optional(),
  ui: toPatchSchema(preference.ui).optional(),
  git: toPatchSchema(preference.git).optional(),
  claude: toPatchSchema(preference.claude).optional(),
  update: toPatchSchema(preference.update).optional(),
  usage: toPatchSchema(preference.usage).optional(),
  agentActivity: toPatchSchema(preference.agentActivity).optional(),
  sessionHistory: toPatchSchema(preference.sessionHistory).optional(),
  reading: toPatchSchema(preference.reading).optional(),
  chat: toPatchSchema(preference.chat).optional(),
  files: toPatchSchema(preference.files).optional(),
  munu: toPatchSchema(preference.munu).optional(),
  theme: z.string().optional(),
  notes: z.string().max(200_000).optional(),
  // A workspace snapshot is replaced as a whole, never merged tab by tab.
  workspace: workspaceBase.optional()
})

export type SettingsPatchInput = z.infer<typeof settingsPatchSchema>

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

/** Top-level Settings keys that hold a preference OBJECT that is merged
 * field by field (`workspace` is replaced whole, so it is not listed). */
const OBJECT_PATCH_KEYS = [
  'terminal',
  'editor',
  'ui',
  'git',
  'claude',
  'update',
  'usage',
  'agentActivity',
  'sessionHistory',
  'reading',
  'chat',
  'files',
  'munu'
] as const satisfies readonly (keyof Settings)[]

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Deep merge of plain objects; arrays, primitives and null replace. */
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = k in base ? deepMerge(base[k], v) : v
  }
  return out
}

/** Pure: merge `patch` into `current` (sections deep-merged, everything else
 * replaced) and validate the completed result. Throws on an invalid result, so
 * a bad patch never reaches the store. */
export function mergeSettingsPatch(current: Settings, patch: SettingsPatchInput): Settings {
  const merged: Record<string, unknown> = { ...current }
  for (const key of OBJECT_PATCH_KEYS) {
    if (patch[key] !== undefined) merged[key] = deepMerge(current[key], patch[key])
  }
  if (patch.theme !== undefined) merged.theme = patch.theme
  if (patch.notes !== undefined) merged.notes = patch.notes
  if (patch.workspace !== undefined) merged.workspace = patch.workspace
  return settingsSchema.parse(merged) as Settings
}

export function applySettingsPatch(patch: SettingsPatchInput): Settings {
  const current = getStore().get()
  return getStore().update(mergeSettingsPatch(current, patch))
}

/** `setAsLastProject` should only be true for the window that owns "last
 * project" restore-on-launch (the primary window) — a SECONDARY (⌘N) window
 * opening its own project must not silently redirect what the primary window
 * reopens next launch. */
export function addRecentProject(entry: RecentProject, setAsLastProject: boolean): Settings {
  const current = getStore().get()
  const recentProjects = [
    entry,
    ...current.recentProjects.filter((r) => r.path !== entry.path)
  ].slice(0, MAX_RECENT_PROJECTS)
  return getStore().update({
    recentProjects,
    ...(setAsLastProject ? { lastProjectPath: entry.path } : {})
  })
}

/** Makes `path` the project a relaunch reopens (a window inherited the primary
 * role, so its project and saved layout are now the ones that must match). */
export function setLastProjectPath(path: string): void {
  getStore().update({ lastProjectPath: path })
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
