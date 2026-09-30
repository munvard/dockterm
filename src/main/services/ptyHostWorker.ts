import { parentPort } from 'node:worker_threads'
import { spawn, type IPty } from 'node-pty'
import type { HostEvent, HostRequest } from './ptyHostProtocol'

// Owns the Windows ptys so a slow CreateProcess (Windows can hold a new console
// program for seconds right after launch) blocks this thread, not the main one.
const ptys = new Map<string, IPty>()

function send(e: HostEvent): void {
  parentPort?.postMessage(e)
}

parentPort?.on('message', (m: HostRequest) => {
  if (m.t === 'sync') {
    Atomics.store(m.flag, 0, 1)
    Atomics.notify(m.flag, 0)
    return
  }
  if (m.t === 'spawn') {
    try {
      const p = spawn(m.file, m.args, m.opts)
      ptys.set(m.id, p)
      send({ t: 'spawned', id: m.id, pid: p.pid })
      p.onData((data) => send({ t: 'data', id: m.id, data }))
      p.onExit(({ exitCode }) => {
        ptys.delete(m.id)
        send({ t: 'exit', id: m.id, exitCode })
      })
    } catch (e) {
      send({ t: 'error', id: m.id, message: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  const p = ptys.get(m.id)
  if (!p) return
  try {
    if (m.t === 'write') p.write(m.data)
    else if (m.t === 'resize') p.resize(m.cols, m.rows)
    else if (m.t === 'pause') p.pause()
    else if (m.t === 'resume') p.resume()
    else if (m.t === 'kill') {
      ptys.delete(m.id)
      p.kill()
    }
  } catch {
    // The pty may have exited between the request and now; nothing to do.
  }
})
