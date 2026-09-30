import { describe, it, expect } from 'vitest'
import { PtyHost, type HostPort } from '../../src/main/services/ptyHost'
import type { HostEvent, HostRequest } from '../../src/main/services/ptyHostProtocol'

function fakePort(): HostPort & { sent: HostRequest[]; emit: (e: HostEvent) => void; die: () => void; terminated: boolean } {
  let onMsg: (e: HostEvent) => void = () => {}
  let onDeath: () => void = () => {}
  const port = {
    sent: [] as HostRequest[],
    terminated: false,
    postMessage: (m: HostRequest) => {
      port.sent.push(m)
    },
    onMessage: (cb: (e: HostEvent) => void) => {
      onMsg = cb
    },
    onDeath: (cb: () => void) => {
      onDeath = cb
    },
    terminate: () => {
      port.terminated = true
    },
    emit: (e: HostEvent) => onMsg(e),
    die: () => onDeath()
  }
  return port
}

const opts = { name: 'xterm-256color', cols: 80, rows: 24, cwd: 'C:\\proj', env: {} }

describe('PtyHost', () => {
  it('sends spawn, then write/resize/pause/resume/kill for that pty, in order', () => {
    const port = fakePort()
    const host = new PtyHost(() => port)
    const pty = host.spawn('powershell.exe', ['-NoLogo'], opts)!
    pty.write('ls\r')
    pty.resize(100, 30)
    pty.pause()
    pty.resume()
    pty.kill()
    const id = (port.sent[0] as { id: string }).id
    expect(port.sent.map((m) => m.t)).toEqual(['spawn', 'write', 'resize', 'pause', 'resume', 'kill'])
    expect(port.sent[0]).toMatchObject({ t: 'spawn', file: 'powershell.exe', args: ['-NoLogo'], opts })
    expect(port.sent.slice(1).every((m) => (m as { id: string }).id === id)).toBe(true)
    expect(pty.process).toBe('xterm-256color')
  })

  it('routes data and exit to the right pty only', () => {
    const port = fakePort()
    const host = new PtyHost(() => port)
    const a = host.spawn('a', [], opts)!
    const b = host.spawn('b', [], opts)!
    const got: string[] = []
    a.onData((d) => got.push(`a:${d}`))
    b.onData((d) => got.push(`b:${d}`))
    let exit: number | null = null
    a.onExit((e) => (exit = e.exitCode))
    const [ida, idb] = port.sent.map((m) => (m as { id: string }).id)
    port.emit({ t: 'data', id: idb, data: 'hi' })
    port.emit({ t: 'data', id: ida, data: 'yo' })
    port.emit({ t: 'exit', id: ida, exitCode: 3 })
    port.emit({ t: 'data', id: ida, data: 'late' })
    expect(got).toEqual(['b:hi', 'a:yo'])
    expect(exit).toBe(3)
  })

  it('shows a spawn failure in the terminal and ends the pty', () => {
    const port = fakePort()
    const host = new PtyHost(() => port)
    const pty = host.spawn('nope.exe', [], opts)!
    const got: string[] = []
    let exit: number | null = null
    pty.onData((d) => got.push(d))
    pty.onExit((e) => (exit = e.exitCode))
    port.emit({ t: 'error', id: (port.sent[0] as { id: string }).id, message: 'File not found: nope.exe' })
    expect(got.join('')).toContain('Failed to start shell: File not found: nope.exe')
    expect(exit).toBe(-1)
  })

  it('ends every live pty when the worker dies, and falls back to in-process after', () => {
    const port = fakePort()
    let made = 0
    const host = new PtyHost(() => {
      made++
      return port
    })
    const pty = host.spawn('a', [], opts)!
    let exit: number | null = null
    pty.onExit((e) => (exit = e.exitCode))
    port.die()
    expect(exit).toBe(-1)
    expect(port.terminated).toBe(true)
    expect(host.spawn('b', [], opts)).toBeNull()
    expect(made).toBe(1)
  })

  it('returns null (spawn in-process) when the worker cannot be created', () => {
    const host = new PtyHost(() => {
      throw new Error('no worker')
    })
    expect(host.spawn('a', [], opts)).toBeNull()
  })

  it('flush waits for the worker to acknowledge, and returns after the timeout if it never does', () => {
    const port = fakePort()
    const host = new PtyHost(() => port)
    host.warm()
    const t = Date.now()
    host.flush(50)
    expect(Date.now() - t).toBeGreaterThanOrEqual(40)
    const sync = port.sent.find((m) => m.t === 'sync') as { flag: Int32Array }
    expect(sync.flag).toBeInstanceOf(Int32Array)
  })

  it('kills the shells of a worker that died, so none keep running unseen', () => {
    const port = fakePort()
    const killed: number[] = []
    const host = new PtyHost(() => port, (pid) => killed.push(pid))
    const a = host.spawn('pwsh.exe', [], opts)!
    const b = host.spawn('pwsh.exe', [], opts)!
    const ids = port.sent.map((m) => (m as { id: string }).id)
    port.emit({ t: 'spawned', id: ids[0], pid: 4242 })
    port.emit({ t: 'spawned', id: ids[1], pid: 4343 })
    const exits: number[] = []
    a.onExit((e) => exits.push(e.exitCode))
    b.onExit((e) => exits.push(e.exitCode))
    b.kill()
    port.die()
    expect(killed).toEqual([4242])
    expect(exits).toEqual([-1])
  })
})
