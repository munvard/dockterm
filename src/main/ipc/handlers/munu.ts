import { z } from 'zod'
import { ok, err } from '@shared/result'
import {
  reportMunu,
  answerMunu,
  focusMunu,
  setMunuInteractive,
  setMunuFocusable,
  resizeMunu,
  showMainWindows
} from '../../services/munuService'
import { getOverlayBounds, moveOverlay, beginOverlayDrag, dragOverlay } from '../../overlayWindow'
import type { Registrar } from '../register'

// .finite() on every plain z.number() below: without it, Infinity/-Infinity
// pass validation (z.number() alone only rejects non-numbers/NaN), and would
// flow straight into window bounds / drag-delta math in overlayWindow.ts.
export const coord = z.number().finite()
export const dragSchema = z.object({ sx: coord, sy: coord })

// Generous but bounded string caps: this data is parsed from Claude's own
// terminal output (askParser), not typed by hand, so it should never be huge
// — but nothing upstream enforces that before it reaches this IPC boundary.
const ID_MAX = 200
const TEXT_MAX = 4000

export const askSchema = z.object({
  leafId: z.string().max(ID_MAX),
  tabId: z.string().max(ID_MAX),
  title: z.string().max(TEXT_MAX).nullable(),
  options: z.array(z.string().max(TEXT_MAX)).max(32),
  descriptions: z.array(z.string().max(TEXT_MAX).nullable()).max(32),
  steps: z.array(z.object({ label: z.string().max(TEXT_MAX), done: z.boolean() })).max(12),
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
  activeTabId: z.string().max(ID_MAX).optional()
})
const answerSchema = z.object({
  leafId: z.string().max(ID_MAX),
  // chunks are mostly tiny (arrows/Enter/digits); one may be typed free text.
  keys: z.array(z.string().max(2000)).max(80)
})
const interactiveSchema = z.object({ interactive: z.boolean() })
const resizeSchema = z.object({
  width: z.number().int().min(40).max(4000),
  height: z.number().int().min(40).max(4000),
  expanded: z.boolean().optional()
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
    resizeMunu(req.width, req.height, req.expanded ?? false)
    return ok(undefined)
  })

  reg('munu:showApp', z.void(), () => {
    showMainWindows()
    return ok(undefined)
  })

  reg('munu:getBounds', z.void(), () => {
    const b = getOverlayBounds()
    if (!b) return err('NOT_FOUND', 'overlay not present')
    return ok(b)
  })

  reg('munu:move', z.object({ x: coord, y: coord }), (req) => {
    moveOverlay(req.x, req.y)
    return ok(undefined)
  })

  reg('munu:dragStart', dragSchema, (req) => {
    beginOverlayDrag(req.sx, req.sy)
    return ok(undefined)
  })

  reg('munu:dragMove', dragSchema, (req) => {
    dragOverlay(req.sx, req.sy)
    return ok(undefined)
  })
}
