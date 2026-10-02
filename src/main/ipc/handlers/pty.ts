import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { ok, err } from '@shared/result'
import {
  createPty,
  writePty,
  resizePty,
  ackPty,
  killPty,
  foregroundProcess,
  isSessionOwner
} from '../../services/ptyService'
import { loadBuffers, saveBuffers } from '../../services/terminalBufferStore'
import { bufferNamespace } from '../../services/windowNamespace'
import type { Registrar } from '../register'

const createSchema = z.object({
  kind: z.enum(['main', 'mini']),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  cwd: z.string().max(4096).optional()
})
const writeSchema = z.object({
  sessionId: z.string().max(64),
  data: z.string().max(1024 * 1024)
})
const resizeSchema = z.object({
  sessionId: z.string().max(64),
  cols: z.number().int(),
  rows: z.number().int()
})
const sessionSchema = z.object({ sessionId: z.string().max(64) })
const ackSchema = z.object({
  sessionId: z.string().max(64),
  bytes: z.number().int().nonnegative()
})
const saveBuffersSchema = z.object({
  buffers: z
    .array(z.object({ leafId: z.string().max(128), data: z.string().max(2_000_000) }))
    .max(64)
})

export function registerPtyHandlers(reg: Registrar): void {
  reg('pty:create', createSchema, (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return err('UNKNOWN', 'No window associated with this request')
    const { sessionId, shell, cwd, cwdFellBack, claudeFlag } = createPty({
      cols: req.cols,
      rows: req.rows,
      cwd: req.cwd,
      win
    })
    return ok({ sessionId, shell, cwd, cwdFellBack, claudeFlag })
  })

  // write/resize/kill/ack all act on an existing session: reject a request
  // from a window (in particular the overlay) that isn't the one that created
  // it, instead of letting any window reach into any pty by guessing its id.
  const NOT_OWNER = (): ReturnType<typeof err> =>
    err('VALIDATION', 'Not the owner of this terminal session')

  reg('pty:write', writeSchema, (req, event) => {
    if (!isSessionOwner(req.sessionId, event.sender.id)) return NOT_OWNER()
    writePty(req.sessionId, req.data)
    return ok(undefined)
  })

  reg('pty:resize', resizeSchema, (req, event) => {
    if (!isSessionOwner(req.sessionId, event.sender.id)) return NOT_OWNER()
    resizePty(req.sessionId, req.cols, req.rows)
    return ok(undefined)
  })

  reg('pty:kill', sessionSchema, (req, event) => {
    if (!isSessionOwner(req.sessionId, event.sender.id)) return NOT_OWNER()
    killPty(req.sessionId)
    return ok(undefined)
  })

  reg('pty:ack', ackSchema, (req, event) => {
    if (!isSessionOwner(req.sessionId, event.sender.id)) return NOT_OWNER()
    ackPty(req.sessionId, req.bytes)
    return ok(undefined)
  })

  reg('pty:foreground', sessionSchema, (req, event) => {
    if (!isSessionOwner(req.sessionId, event.sender.id)) return NOT_OWNER()
    return ok({ process: foregroundProcess(req.sessionId) })
  })

  // Saved scrollback is namespaced by main (the window's own project), never by
  // anything the renderer sends: a window reads and writes only its own.
  reg('terminal:saveBuffers', saveBuffersSchema, (req, event) => {
    saveBuffers(bufferNamespace(event.sender.id), req.buffers)
    return ok(undefined)
  })

  reg('terminal:loadBuffers', z.void(), (_req, event) =>
    ok(loadBuffers(bufferNamespace(event.sender.id)))
  )
}
