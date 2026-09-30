/** Messages between the main process and the pty host worker (ptyHostWorker.ts). */

export interface HostSpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string | undefined>
  useConptyDll?: boolean
}

export type HostRequest =
  | { t: 'spawn'; id: string; file: string; args: string[] | string; opts: HostSpawnOptions }
  | { t: 'write'; id: string; data: string }
  | { t: 'resize'; id: string; cols: number; rows: number }
  | { t: 'pause'; id: string }
  | { t: 'resume'; id: string }
  | { t: 'kill'; id: string }
  /** Answered by setting flag[0] to 1 and notifying: every earlier request has been handled. */
  | { t: 'sync'; flag: Int32Array }

export type HostEvent =
  | { t: 'spawned'; id: string; pid: number }
  | { t: 'data'; id: string; data: string }
  | { t: 'exit'; id: string; exitCode: number }
  | { t: 'error'; id: string; message: string }
