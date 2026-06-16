/** Domain types shared between main and renderer. Extended per milestone. */

export type PanelId = 'files' | 'git' | 'review' | 'mcp' | 'skills' | 'info' | 'settings'

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
}

export interface GitSettings {
  beginnerMode: boolean
  confirmDanger: boolean
}

export interface ClaudeSettings {
  /** Opt-in (default false): allow reading user-scope ~/.claude config for MCP/skills panels. */
  readUserConfig: boolean
}

/** Persisted terminal tabs for the window, restored on relaunch. */
export interface WorkspacePersist {
  tabs: { id: string; title: string; cwd: string }[]
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

export type McpScope = 'project' | 'user' | 'local'

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
  scope: 'project' | 'user'
  sourcePath: string
  canOpen: boolean
  disableModelInvocation: boolean
}

export interface CommandView {
  slashName: string
  description: string
  scope: 'project' | 'user'
  sourcePath: string
  canOpen: boolean
}

export interface SkillsReadResult {
  skills: SkillView[]
  commands: CommandView[]
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
