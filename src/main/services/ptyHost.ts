import type { HostEvent, HostRequest, HostSpawnOptions } from './ptyHostProtocol'

/** The part of node-pty's IPty that ptyService uses; a RemotePty stands in for it. */
export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  pause(): void
  resume(): void
  kill(): void
  onData(cb: (data: string) => void): unknown
  onExit(cb: (e: { exitCode: number }) => void): unknown
  readonly process: string
}

/** The host worker as PtyHost sees it (a fake in tests). */
export interface HostPort {
  postMessage(m: HostRequest): void
  onMessage(cb: (e: HostEvent) => void): void
  /** The worker failed to load, crashed or exited. */
  onDeath(cb: () => void): void
  terminate(): void
}

class RemotePty implements PtyLike {
  private dataCbs: ((data: string) => void)[] = []
  private exitCbs: ((e: { exitCode: number }) => void)[] = []
  private exited = false
  /** The shell's process id, once the worker has started it. */
  pid: number | null = null

  constructor(
    private readonly host: PtyHost,
    readonly id: string,
    readonly process: string
  ) {}

  write(data: string): void {
    this.host.post({ t: 'write', id: this.id, data })
  }
  resize(cols: number, rows: number): void {
    this.host.post({ t: 'resize', id: this.id, cols, rows })
  }
  pause(): void {
    this.host.post({ t: 'pause', id: this.id })
  }
  resume(): void {
    this.host.post({ t: 'resume', id: this.id })
  }
  kill(): void {
    this.host.post({ t: 'kill', id: this.id })
    this.host.forget(this.id)
  }
  onData(cb: (data: string) => void): void {
    this.dataCbs.push(cb)
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCbs.push(cb)
  }

  emitData(data: string): void {
    if (this.exited) return
    for (const cb of this.dataCbs) cb(data)
  }
  emitExit(exitCode: number): void {
    if (this.exited) return
    this.exited = true
    this.host.forget(this.id)
    for (const cb of this.exitCbs) cb({ exitCode })
  }
}

/**
 * Runs ptys in a worker thread. On Windows, CreateProcess for a new console program
 * can stall for seconds right after DockTerm starts; node-pty makes that call
 * synchronously, so in the main process it froze every window and IPC call until
 * the first shell was up. In the worker only that shell waits.
 */
export class PtyHost {
  private port: HostPort | null = null
  private failed = false
  private readonly live = new Map<string, RemotePty>()
  private counter = 0

  constructor(
    private readonly create: () => HostPort,
    /** Ends a shell's whole process tree (terminating the worker does not). */
    private readonly killTree: (pid: number) => void = () => {}
  ) {}

  /** Start the worker ahead of the first pty, so its boot overlaps window loading. */
  warm(): void {
    this.ensure()
  }

  /** A pty in the host, or null when the host is unavailable (the caller spawns in-process). */
  spawn(file: string, args: string[] | string, opts: HostSpawnOptions): PtyLike | null {
    const port = this.ensure()
    if (!port) return null
    const id = `h${++this.counter}`
    const pty = new RemotePty(this, id, opts.name)
    this.live.set(id, pty)
    port.postMessage({ t: 'spawn', id, file, args, opts })
    return pty
  }

  post(m: HostRequest): void {
    this.port?.postMessage(m)
  }

  forget(id: string): void {
    this.live.delete(id)
  }

  /**
   * Wait (at most `timeoutMs`) until the worker has handled every request sent so
   * far. Used at quit, so the kills reach the shells before the process exits.
   */
  flush(timeoutMs: number): void {
    if (!this.port) return
    const flag = new Int32Array(new SharedArrayBuffer(4))
    this.port.postMessage({ t: 'sync', flag })
    Atomics.wait(flag, 0, 0, timeoutMs)
  }

  private ensure(): HostPort | null {
    if (this.port) return this.port
    if (this.failed) return null
    try {
      const port = this.create()
      port.onMessage((e) => this.onEvent(e))
      port.onDeath(() => this.die(port))
      this.port = port
      return port
    } catch {
      this.failed = true
      return null
    }
  }

  private onEvent(e: HostEvent): void {
    const pty = this.live.get(e.id)
    if (!pty) return
    if (e.t === 'spawned') pty.pid = e.pid
    else if (e.t === 'data') pty.emitData(e.data)
    else if (e.t === 'exit') pty.emitExit(e.exitCode)
    else {
      pty.emitData(`\x1b[31mFailed to start shell: ${e.message}\x1b[0m\r\n`)
      pty.emitExit(-1)
    }
  }

  /** A dead worker's shells are killed (terminating a worker leaves its ConPTY
   * children running, unseen); later ptys spawn in-process. */
  private die(port: HostPort): void {
    if (this.port !== port) return
    this.port = null
    this.failed = true
    try {
      port.terminate()
    } catch {
      // already gone
    }
    for (const pty of [...this.live.values()]) {
      if (pty.pid !== null) {
        try {
          this.killTree(pty.pid)
        } catch {
          // best effort: the process may already be gone
        }
      }
      pty.emitExit(-1)
    }
  }
}
