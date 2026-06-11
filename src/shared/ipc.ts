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

/* ------------------------------- channel maps ----------------------------- */

export interface InvokeChannels {
  'app:getInfo': (req: void) => Result<AppInfo>
  'pty:create': (req: CreatePtyReq) => Result<CreatePtyRes>
  'pty:write': (req: WritePtyReq) => Result<void>
  'pty:resize': (req: ResizePtyReq) => Result<void>
  'pty:kill': (req: SessionRef) => Result<void>
  'pty:ack': (req: AckPtyReq) => Result<void>
}

export interface EventChannels {
  'pty:data': PtyDataEvent
  'pty:exit': PtyExitEvent
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
  'pty:ack'
]

/** Runtime allowlist mirrored from `EventChannels`. */
export const EVENT_CHANNELS: readonly EventName[] = ['pty:data', 'pty:exit']

export interface DockTermApi {
  invoke<C extends InvokeChannel>(channel: C, req: ReqOf<C>): Promise<ResOf<C>>
  on<E extends EventName>(event: E, cb: (payload: EventChannels[E]) => void): () => void
}
