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
  SkillTemplate,
  ProjectInfoData
} from './types'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

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
  Pick<Settings, 'terminal' | 'editor' | 'ui' | 'git' | 'claude' | 'workspace' | 'theme'>
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
  'project:setActiveRoot': (req: PathReq) => Result<void>

  'fs:readTree': (req: RelPathReq) => Result<TreeNode[]>
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
  'claude:skillCreate': (req: {
    name: string
    kind: 'skill' | 'command'
    template: SkillTemplate
  }) => Result<{ relPath: string }>

  'info:get': (req: void) => Result<ProjectInfoData>
  'app:openExternal': (req: { url: string }) => Result<void>

  'window:new': (req: void) => Result<void>
  'window:isPrimary': (req: void) => Result<boolean>
}

export interface EventChannels {
  'pty:data': PtyDataEvent
  'pty:exit': PtyExitEvent
  'settings:changed': Settings
  'fs:watch': WatchBatch
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
  'claude:skillCreate',
  'info:get',
  'app:openExternal',
  'window:new',
  'window:isPrimary'
]

/** Runtime allowlist mirrored from `EventChannels`. */
export const EVENT_CHANNELS: readonly EventName[] = [
  'pty:data',
  'pty:exit',
  'settings:changed',
  'fs:watch'
]

export interface DockTermApi {
  invoke<C extends InvokeChannel>(channel: C, req: ReqOf<C>): Promise<ResOf<C>>
  on<E extends EventName>(event: E, cb: (payload: EventChannels[E]) => void): () => void
}
