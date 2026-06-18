/** Domain types shared between main and renderer. Extended per milestone. */

export type PanelId =
  | 'files'
  | 'git'
  | 'review'
  | 'mcp'
  | 'skills'
  | 'agents'
  | 'usage'
  | 'info'
  | 'settings'

/** Where a skill/command/agent was found. */
export type ItemScope = 'project' | 'user' | 'plugin'

/** munu (the mascot) state, aggregated across panes/windows. */
export type MunuState = 'idle' | 'working' | 'asking' | 'done'
/** Which mascot character the user has chosen. Default 'munu'. */
export type MascotCharacter = 'munu' | 'nvurd' | 'guru' | 'adanana'
/** A parsed Claude permission prompt. */
export interface AskInfo {
  /** cleaned question/command context (box-drawing stripped), if any */
  title: string | null
  /** the menu option labels, in order (numbers + checkbox markers stripped) */
  options: string[]
  /** per-option helper text shown beneath it in the prompt (null if none) */
  descriptions: (string | null)[]
  /** multi-step wizard breadcrumb, if the prompt has one (else empty) */
  steps: { label: string; done: boolean }[]
  /** true only for a clear Yes/No confirm — the only case we offer [y]/[n] */
  binary: boolean
  /** true for a checkbox prompt where several options can be toggled before submit */
  multiSelect: boolean
  /** per-option: whether it's a toggleable checkbox (vs an action row like Submit) */
  checkable: boolean[]
  /** per-option: initial checked state (multi-select only) */
  checked: boolean[]
  /** index of the "Submit" row in `options`, or null */
  submitIndex: number | null
  /** the row index Claude's menu cursor currently sits on (the ❯ marker) */
  cursorRow: number
}
/** A pane that is waiting for the user's permission. */
export interface MunuAsk extends AskInfo {
  leafId: string
  tabId: string
  /** true when the user can currently see this pane (its window is focused and
   * its tab is active) — the overlay then suppresses the option card. */
  visible: boolean
}
export interface MunuGlobal {
  state: MunuState
  asks: MunuAsk[]
  /** The reporting window's active tab id (used to compute ask visibility). */
  activeTabId?: string
}
export type MunuSettings = {
  enabled: boolean
  overlay: boolean
  sounds: boolean
  attention: boolean
  keepAwake: boolean
  notifications: boolean
  /** Overlay munu face size in px (the notch pill). Default 56. */
  size: number
  /** The chosen mascot character. Default 'munu'. */
  character: MascotCharacter
  /** When true, the icon stays visible and is draggable. Default false. */
  pinned: boolean
  /** Persisted screen position when pinned (top-left of the overlay window). */
  position: { x: number; y: number } | null
}

export type AccentName = 'violet' | 'blue' | 'teal'
export type TerminalRenderer = 'auto' | 'dom'
export type CursorStyle = 'block' | 'underline' | 'bar'

export interface TerminalSettings {
  /** null = use the built-in mono stack. */
  fontFamily: string | null
  fontSize: number
  cursorStyle: CursorStyle
  cursorBlink: boolean
  renderer: TerminalRenderer
  scrollback: number
  /** Inject shell integration so the dock follows the terminal's `cd` (OSC 7). */
  shellIntegration: boolean
}

export interface EditorSettings {
  fontSize: number
}

export interface UiSettings {
  accent: AccentName
  dockWidth: number
  editorRatio: number
  miniTermHeight: number
  openPanel: PanelId | null
  miniTermOpen: boolean
  editorOpen: boolean
  /** Whole-UI zoom factor (1 = 100%). Scales chrome, terminals and the editor. */
  zoom: number
}

export interface GitSettings {
  beginnerMode: boolean
  confirmDanger: boolean
}

export interface ClaudeSettings {
  /** Opt-in (default false): allow reading user-scope ~/.claude config for MCP/skills panels. */
  readUserConfig: boolean
  /** Optional override directories, for users who keep their config elsewhere.
   * Scanned in addition to the default locations. Empty string = unset. */
  paths: {
    skills: string
    commands: string
    agents: string
    /** Extra MCP config file (.mcp.json shape) to read. */
    mcpConfig: string
  }
}

export interface UpdateSettings {
  /** Poll GitHub for new releases (on launch + every ~6h). */
  checkAutomatically: boolean
  /** A version the user chose to skip; never prompt for it again. */
  dismissedVersion: string | null
  /** Epoch ms before which we won't prompt again ("remind me later"). */
  remindAfter: number
}

/** Persisted terminal tabs for the window, restored on relaunch. `layout` is the
 * opaque tiling tree (validated/cast by the renderer). */
export interface WorkspacePersist {
  tabs: { id: string; title: string; layout: unknown; focusedLeafId: string }[]
  activeId: string
}

export interface Checkpoint {
  hash: string
  branch: string
  label: string
  createdAt: number
}

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
}

export interface Settings {
  schemaVersion: number
  lastProjectPath: string | null
  recentProjects: RecentProject[]
  terminal: TerminalSettings
  editor: EditorSettings
  ui: UiSettings
  git: GitSettings
  claude: ClaudeSettings
  update: UpdateSettings
  /** Selected theme id, or 'auto' to follow the OS appearance. */
  theme: string
  munu: MunuSettings
  workspace: WorkspacePersist | null
  /** Keyed by project path. */
  checkpoints: Record<string, Checkpoint>
}

export interface ProjectInfo {
  path: string
  name: string
  isGitRepo: boolean
  branch: string | null
}

/* ---------------------------------- MCP ---------------------------------- */

export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown'

export type McpScope = 'project' | 'user' | 'local' | 'connector' | 'plugin'

export interface McpServerView {
  name: string
  scope: McpScope
  transport: McpTransport
  command?: string
  url?: string
  envKeys: string[]
  headerKeys: string[]
  sourcePath: string
}

export interface McpSource {
  path: string
  scope: McpScope
  exists: boolean
  ok: boolean
  error?: string
}

export interface McpReadResult {
  servers: McpServerView[]
  sources: McpSource[]
}

/* --------------------------------- Skills -------------------------------- */

export interface SkillView {
  slashName: string
  description: string
  scope: ItemScope
  sourcePath: string
  canOpen: boolean
  disableModelInvocation: boolean
}

export interface CommandView {
  slashName: string
  description: string
  scope: ItemScope
  sourcePath: string
  canOpen: boolean
}

export interface SkillsReadResult {
  skills: SkillView[]
  commands: CommandView[]
}

/** A Claude Code subagent (`.claude/agents/*.md`). */
export interface AgentView {
  name: string
  description: string
  scope: ItemScope
  sourcePath: string
  canOpen: boolean
}

export interface AgentsReadResult {
  agents: AgentView[]
}

/* --------------------------------- Usage --------------------------------- */

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheCreateTokens: number
  cacheReadTokens: number
  /** input + output + cache-write + cache-read */
  totalTokens: number
  /** assistant messages counted in this bucket */
  messages: number
}

export interface UsageBucket extends UsageTotals {
  /** stable key (date / model / project path) */
  key: string
  /** display label */
  label: string
}

/** Aggregated, tokens-only view of local Claude Code usage (from ~/.claude
 * transcripts), computed relative to a moment in time. */
export interface UsageSnapshot {
  updatedAt: number
  today: UsageTotals
  last5h: UsageTotals
  last7d: UsageTotals
  last30d: UsageTotals
  allTime: UsageTotals
  /** per-day for the last 30 days, oldest → newest (sparkline) */
  daily: UsageBucket[]
  /** by model, desc by total tokens */
  byModel: UsageBucket[]
  /** by project, desc by total tokens (top 8) */
  byProject: UsageBucket[]
  empty: boolean
}

export type SkillTemplate =
  | 'brainstorming'
  | 'ultraplan'
  | 'review-changes'
  | 'safe-commit'
  | 'blank'

/* ------------------------------ Project info ----------------------------- */

export interface ProjectScript {
  name: string
  command: string
}

export interface ProjectInfoData {
  name: string | null
  root: string
  packageManager: string | null
  scripts: ProjectScript[]
  frameworks: string[]
  remote: string | null
}

/* ---------------------------------- Git ---------------------------------- */

export type GitFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'

export interface GitFileEntry {
  path: string
  status: GitFileStatus
  staged: boolean
  origPath?: string
}

export interface GitUpstream {
  remote: string
  ahead: number
  behind: number
}

export type GitRepoState = 'ok' | 'empty' | 'detached' | 'conflicted' | 'not-repo'

export interface GitStatusView {
  repoState: GitRepoState
  branch: string | null
  upstream: GitUpstream | null
  staged: GitFileEntry[]
  unstaged: GitFileEntry[]
  untracked: GitFileEntry[]
  conflicted: GitFileEntry[]
  clean: boolean
}

export interface GitBranches {
  current: string | null
  all: string[]
}

export interface CommitResultView {
  hash: string
  summary: string
}

/* -------------------------------- Review --------------------------------- */

export type ReviewBase = 'working' | 'session' | 'checkpoint'

export interface DiffSinceFile {
  relPath: string
  status: GitFileStatus
  insertions: number
  deletions: number
}

export interface DiffContent {
  relPath: string
  original: string
  modified: string
}

export type CheckpointResult = { checkpoint: Checkpoint } | { dirty: true }

export interface CheckpointStatus {
  checkpoint: Checkpoint | null
  stale: boolean
}
