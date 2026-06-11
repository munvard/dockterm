import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { ok, err } from '@shared/result'
import { createPty, writePty, resizePty, ackPty, killPty } from '../../services/ptyService'
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

export function registerPtyHandlers(reg: Registrar): void {
  reg('pty:create', createSchema, (req, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return err('UNKNOWN', 'No window associated with this request')
    const { sessionId, shell } = createPty({ cols: req.cols, rows: req.rows, cwd: req.cwd, win })
    return ok({ sessionId, shell })
  })

  reg('pty:write', writeSchema, (req) => {
    writePty(req.sessionId, req.data)
    return ok(undefined)
  })

  reg('pty:resize', resizeSchema, (req) => {
    resizePty(req.sessionId, req.cols, req.rows)
    return ok(undefined)
  })

  reg('pty:kill', sessionSchema, (req) => {
    killPty(req.sessionId)
    return ok(undefined)
  })

  reg('pty:ack', ackSchema, (req) => {
    ackPty(req.sessionId, req.bytes)
    return ok(undefined)
  })
}
