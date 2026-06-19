/**
 * The single source of truth for the renderer <-> main contract.
 *
 * `InvokeChannels` models request/response calls (ipcRenderer.invoke). Each entry
 * is written as a function type `(req) => Result<res>` purely so we can extract the
 * request and response types with `ReqOf` / `ResOf`.
 *
 * `EventChannels` models main -> renderer pushes (ipcRenderer.on).
 *
 * Channels are added here milestone by milestone; the preload bridge and the
 * main-process registry both validate against the runtime allowlists below.
 */
import type { Result } from './result'
import type {
  Settings,
  ProjectInfo,
  RecentProject,
  GitStatusView,
  GitBranches,
  CommitResultView,
  ReviewBase,
  DiffSinceFile,
  DiffContent,
  CheckpointResult,
  CheckpointStatus,
  McpReadResult,
  SkillsReadResult,
  AgentsReadResult,
  SkillTemplate,
  ProjectInfoData,
  MunuGlobal,
  UsageSnapshot
} from './types'

export interface UpdateAvailable {
  latestVersion: string
  releaseUrl: string
  notes: string
  /** true if an installer for this exact OS/arch was found (in-app download works). */
  canAutoUpdate: boolean
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  /** The user's home directory — for "open a terminal here" quick starts. */
  home: string
}

/** Application-menu items that route to the focused renderer (File/View, etc.). */
export type MenuAction =
  | 'newTab'
  | 'openProject'
  | 'closeTab'
  | 'splitRight'
  | 'splitDown'
  | 'settings'

/* ----------------------------------- PTY ---------------------------------- */

export interface CreatePtyReq {
  kind: 'main' | 'mini'
  cols: number
  rows: number
  cwd?: string
}
export interface CreatePtyRes {
  sessionId: string
  shell: string
}
export interface WritePtyReq {
  sessionId: string
  data: string
}
export interface ResizePtyReq {
  sessionId: string
  cols: number
  rows: number
}
export interface SessionRef {
  sessionId: string
}
export interface AckPtyReq {
  sessionId: string
  bytes: number
}
export interface PtyDataEvent {
  sessionId: string
  data: string
}
export interface PtyExitEvent {
  sessionId: string
  exitCode: number
}

/* ------------------------------ project / fs ------------------------------ */

export type OpenDialogResult = { path: string } | { canceled: true }
export interface PathReq {
  path: string
}
export interface RelPathReq {
  relPath: string
}

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
  relPath: string
}
export interface WatchBatch {
  events: WatchEvent[]
}

export interface TreeNode {
  name: string
  relPath: string
  type: 'file' | 'dir'
}

export type ReadFileResult =
  | { kind: 'text'; content: string; mtimeMs: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }

export type WriteFileResult =
  | { kind: 'ok'; mtimeMs: number }
  | { kind: 'conflict'; mtimeMs: number }

export interface WriteFileReq {
  relPath: string
  content: string
  expectedMtimeMs: number | null
}
export interface RenameReq {
  fromRelPath: string
  toRelPath: string
}

export interface ImageDataResult {
  dataUrl: string
  size: number
}

/* ---------------------------------- git ----------------------------------- */

export interface PathsReq {
  paths: string[]
}
export interface CommitReq {
  message: string
}
export interface PushReq {
  setUpstream?: boolean
  forceWithLease?: boolean
}
export interface BranchReq {
  name: string
}
export interface GitOutput {
  output: string
}

/* -------------------------------- settings -------------------------------- */

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'terminal'
    | 'editor'
    | 'ui'
    | 'git'
    | 'claude'
    | 'update'
    | 'usage'
    | 'munu'
    | 'workspace'
    | 'theme'
    | 'notes'
  >
>

/* ------------------------------- channel maps ----------------------------- */

export interface InvokeChannels {
  'app:getInfo': (req: void) => Result<AppInfo>

  'pty:create': (req: CreatePtyReq) => Result<CreatePtyRes>
  'pty:write': (req: WritePtyReq) => Result<void>
  'pty:resize': (req: ResizePtyReq) => Result<void>
  'pty:kill': (req: SessionRef) => Result<void>
  'pty:ack': (req: AckPtyReq) => Result<void>

  'settings:get': (req: void) => Result<Settings>
  'settings:set': (req: SettingsPatch) => Result<Settings>

  'project:openDialog': (req: void) => Result<OpenDialogResult>
  'project:open': (req: PathReq) => Result<ProjectInfo>
  'project:getRecent': (req: void) => Result<RecentProject[]>
  'project:gitInit': (req: PathReq) => Result<ProjectInfo>
  'project:setActiveRoot': (req: PathReq) => Result<{ root: string }>

  'fs:readTree': (req: RelPathReq) => Result<TreeNode[]>
  'fs:search': (req: { query: string }) => Result<TreeNode[]>
  'fs:readFile': (req: RelPathReq) => Result<ReadFileResult>
  'fs:writeFile': (req: WriteFileReq) => Result<WriteFileResult>
  'fs:createFile': (req: RelPathReq) => Result<void>
  'fs:createDir': (req: RelPathReq) => Result<void>
  'fs:rename': (req: RenameReq) => Result<void>
  'fs:delete': (req: RelPathReq) => Result<void>
  'fs:reveal': (req: RelPathReq) => Result<void>
  'fs:readDataUrl': (req: RelPathReq) => Result<ImageDataResult>
  'fs:openPath': (req: RelPathReq) => Result<void>

  'git:status': (req: void) => Result<GitStatusView>
  'git:stage': (req: PathsReq) => Result<void>
  'git:stageAll': (req: void) => Result<void>
  'git:unstage': (req: PathsReq) => Result<void>
  'git:discard': (req: PathsReq) => Result<void>
  'git:commit': (req: CommitReq) => Result<CommitResultView>
  'git:push': (req: PushReq) => Result<GitOutput>
  'git:pull': (req: void) => Result<GitOutput>
  'git:branches': (req: void) => Result<GitBranches>
  'git:createBranch': (req: BranchReq) => Result<void>
  'git:switchBranch': (req: BranchReq) => Result<void>
  'git:deleteBranch': (req: BranchReq) => Result<void>

  'review:list': (req: { base: ReviewBase }) => Result<DiffSinceFile[]>
  'review:diffFile': (req: { base: ReviewBase; relPath: string }) => Result<DiffContent>
  'checkpoint:create': (req: { label: string }) => Result<CheckpointResult>
  'checkpoint:get': (req: void) => Result<CheckpointStatus>

  'claude:mcpRead': (req: { includeUser: boolean }) => Result<McpReadResult>
  'claude:mcpCreateTemplate': (req: void) => Result<{ relPath: string }>
  'claude:skillsRead': (req: { includeUser: boolean }) => Result<SkillsReadResult>
  'claude:agentsRead': (req: { includeUser: boolean }) => Result<AgentsReadResult>
  'claude:skillCreate': (req: {
    name: string
    kind: 'skill' | 'command'
    template: SkillTemplate
  }) => Result<{ relPath: string }>

  'info:get': (req: void) => Result<ProjectInfoData>
  'app:openExternal': (req: { url: string }) => Result<void>

  /** Aggregated, tokens-only Claude usage from local ~/.claude transcripts. */
  'usage:get': (req: void) => Result<UsageSnapshot>

  // updates — manual check + snooze/skip + in-app download/install.
  'update:check': (req: void) => Result<{ upToDate: boolean }>
  'update:download': (req: void) => Result<void>
  'update:snooze': (req: { hours: number }) => Result<void>
  'update:skip': (req: { version: string }) => Result<void>

  'window:new': (req: void) => Result<void>
  'window:isPrimary': (req: void) => Result<boolean>
  'app:recover': (req: { hard: boolean }) => Result<void>
  'ui:setZoom': (req: { factor: number }) => Result<{ zoom: number }>

  // munu — each window reports its aggregate; the overlay drives answers/focus.
  'munu:report': (req: MunuGlobal) => Result<void>
  /** Answer the asking pane `leafId` by writing `keys` (a sequence of individual
   * key chunks — digits, arrows, Enter) one at a time, paced, into its PTY. */
  'munu:answer': (req: { leafId: string; keys: string[] }) => Result<void>
  'munu:focus': (req: void) => Result<void>
  'munu:setInteractive': (req: { interactive: boolean }) => Result<void>
  /** Make the overlay focusable while the user types into munu's text field
   * (the window is non-focusable by default so it never steals focus). */
  'munu:setFocusable': (req: { focusable: boolean }) => Result<void>
  /** The overlay's content size changed — resize the floating window to fit.
   * `expanded` = the popup / ask-card is open, so a pinned munu stays centred. */
  'munu:resize': (req: { width: number; height: number; expanded?: boolean }) => Result<void>
  /** Bring the DockTerm window(s) to the front (used when munu is clicked). */
  'munu:showApp': (req: void) => Result<void>
  /** Read the overlay window's current screen bounds (drag start reference). */
  'munu:getBounds': (req: void) => Result<{ x: number; y: number; width: number; height: number }>
  /** Move the overlay window to an absolute screen position (clamped on-screen). */
  'munu:move': (req: { x: number; y: number }) => Result<void>
}

export interface EventChannels {
  'pty:data': PtyDataEvent
  'pty:exit': PtyExitEvent
  'settings:changed': Settings
  'fs:watch': WatchBatch
  /** main → overlay window: the global munu state. */
  'munu:state': MunuGlobal
  /** main → overlay: reveal (slide down) or hide (tuck into the notch). */
  'munu:reveal': boolean
  /** main → the window owning an asking pane: key chunks to write into the PTY
   * one at a time, paced, so the TUI registers each as a separate keypress. */
  'munu:doAnswer': { leafId: string; keys: string[] }
  /** main → the window owning an asking pane: focus that pane. */
  'munu:doFocus': { tabId: string; leafId: string }
  /** main → renderer: a newer release is available (poll-based). */
  'update:available': UpdateAvailable
  /** main → renderer: in-app update download progress / result. */
  'update:progress': { percent: number }
  'update:downloaded': { path: string }
  'update:error': { message: string }
  /** main → renderer: a fresh usage snapshot (transcripts grew). */
  'usage:changed': UsageSnapshot
  /** main → focused renderer: an application-menu item was chosen. */
  'menu:action': { action: MenuAction }
}

export type InvokeChannel = keyof InvokeChannels
export type EventName = keyof EventChannels

export type ReqOf<C extends InvokeChannel> = Parameters<InvokeChannels[C]>[0]
export type ResOf<C extends InvokeChannel> = ReturnType<InvokeChannels[C]>

/** Runtime allowlist mirrored from `InvokeChannels` — kept in sync by hand. */
export const INVOKE_CHANNELS: readonly InvokeChannel[] = [
  'app:getInfo',
  'pty:create',
  'pty:write',
  'pty:resize',
  'pty:kill',
  'pty:ack',
  'settings:get',
  'settings:set',
  'project:openDialog',
  'project:open',
  'project:getRecent',
  'project:gitInit',
  'project:setActiveRoot',
  'fs:readTree',
  'fs:search',
  'fs:readFile',
  'fs:writeFile',
  'fs:createFile',
  'fs:createDir',
  'fs:rename',
  'fs:delete',
  'fs:reveal',
  'fs:readDataUrl',
  'fs:openPath',
  'git:status',
  'git:stage',
  'git:stageAll',
  'git:unstage',
  'git:discard',
  'git:commit',
  'git:push',
  'git:pull',
  'git:branches',
  'git:createBranch',
  'git:switchBranch',
  'git:deleteBranch',
  'review:list',
  'review:diffFile',
  'checkpoint:create',
  'checkpoint:get',
  'claude:mcpRead',
  'claude:mcpCreateTemplate',
  'claude:skillsRead',
  'claude:agentsRead',
  'claude:skillCreate',
  'info:get',
  'app:openExternal',
  'usage:get',
  'update:check',
  'update:download',
  'update:snooze',
  'update:skip',
  'window:new',
  'window:isPrimary',
  'app:recover',
  'ui:setZoom',
  'munu:report',
  'munu:answer',
  'munu:focus',
  'munu:setInteractive',
  'munu:setFocusable',
  'munu:resize',
  'munu:showApp',
  'munu:getBounds',
  'munu:move'
]

/** Runtime allowlist mirrored from `EventChannels`. */
export const EVENT_CHANNELS: readonly EventName[] = [
  'pty:data',
  'pty:exit',
  'settings:changed',
  'fs:watch',
  'munu:state',
  'munu:reveal',
  'munu:doAnswer',
  'munu:doFocus',
  'update:available',
  'update:progress',
  'update:downloaded',
  'update:error',
  'usage:changed',
  'menu:action'
]

export interface DockTermApi {
  invoke<C extends InvokeChannel>(channel: C, req: ReqOf<C>): Promise<ResOf<C>>
  on<E extends EventName>(event: E, cb: (payload: EventChannels[E]) => void): () => void
  /** Resolve the absolute path of a dropped File (Electron webUtils). '' if unknown. */
  pathForFile(file: File): string
}
