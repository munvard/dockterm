import { z } from 'zod'
import { ok } from '@shared/result'
import {
  reportMunu,
  answerMunu,
  focusMunu,
  setMunuInteractive,
  setMunuFocusable,
  resizeMunu
} from '../../services/munuService'
import type { Registrar } from '../register'

const askSchema = z.object({
  leafId: z.string(),
  tabId: z.string(),
  title: z.string().nullable(),
  options: z.array(z.string()).max(32),
  descriptions: z.array(z.string().nullable()).max(32),
  steps: z.array(z.object({ label: z.string(), done: z.boolean() })).max(12),
  binary: z.boolean(),
  multiSelect: z.boolean(),
  checkable: z.array(z.boolean()).max(32),
  checked: z.array(z.boolean()).max(32),
  submitIndex: z.number().int().min(0).max(32).nullable(),
  cursorRow: z.number().int().min(0).max(64),
  visible: z.boolean()
})
const reportSchema = z.object({
  state: z.enum(['idle', 'working', 'asking', 'done']),
  asks: z.array(askSchema).max(64),
  activeTabId: z.string().optional()
})
const answerSchema = z.object({
  leafId: z.string(),
  // chunks are mostly tiny (arrows/Enter/digits); one may be typed free text.
  keys: z.array(z.string().max(2000)).max(80)
})
const interactiveSchema = z.object({ interactive: z.boolean() })
const resizeSchema = z.object({
  width: z.number().int().min(40).max(4000),
  height: z.number().int().min(40).max(4000)
})

export function registerMunuHandlers(reg: Registrar): void {
  reg('munu:report', reportSchema, (req, event) => {
    reportMunu(event.sender.id, req)
    return ok(undefined)
  })

  reg('munu:answer', answerSchema, (req) => {
    answerMunu(req.leafId, req.keys)
    return ok(undefined)
  })

  reg('munu:focus', z.void(), () => {
    focusMunu()
    return ok(undefined)
  })

  reg('munu:setInteractive', interactiveSchema, (req) => {
    setMunuInteractive(req.interactive)
    return ok(undefined)
  })

  reg('munu:setFocusable', z.object({ focusable: z.boolean() }), (req) => {
    setMunuFocusable(req.focusable)
    return ok(undefined)
  })

  reg('munu:resize', resizeSchema, (req) => {
    resizeMunu(req.width, req.height)
    return ok(undefined)
  })
}
