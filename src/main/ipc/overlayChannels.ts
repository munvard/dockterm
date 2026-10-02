/**
 * The munu overlay is a much smaller, always-on-top surface than the main
 * window, and has no business calling fs/git/pty/project channels even
 * though it's an equally "trusted" (app://) renderer — it should only ever
 * reach the handlers its own UI actually invokes. register.ts checks this by
 * the sender's registered window role (windowRoles.ts) rather than by adding an
 * `allow` option to every handler registration, so every OTHER wave's
 * handler file needs zero changes to get this restriction; a channel a
 * future overlay feature needs is opted in here, in one place.
 *
 * Split into its own module (no electron import) so the allowlist logic is
 * unit-testable without pulling in the entire handler-registration graph.
 */
import type { WindowRole } from './windowRoles'

export const OVERLAY_ALLOWED_CHANNELS = new Set<string>([
  'munu:answer',
  'munu:focus',
  'munu:setInteractive',
  'munu:setFocusable',
  'munu:resize',
  'munu:showApp',
  'munu:getBounds',
  'munu:move',
  'munu:dragStart',
  'munu:dragMove',
  'munu:setHit',
  'overlaySettings:get',
  'overlaySettings:set',
  'app:getInfo',
  'activity:get'
])

/** Channels only the overlay may call (a main window has no use for them, and
 * `munu:answer` in particular must never be reachable from a terminal window). */
export const OVERLAY_ONLY_CHANNELS = new Set<string>([
  'munu:answer',
  'overlaySettings:get',
  'overlaySettings:set'
])

/** The floating usage window reads real usage and its own config, nothing else. */
export const USAGE_WIDGET_ALLOWED_CHANNELS = new Set<string>([
  'usage:realGet',
  'usageHistory:get',
  'usageFloat:get',
  'usageFloat:set',
  'usageFloat:close'
])

/** Channels only the floating usage window may call. */
export const USAGE_WIDGET_ONLY_CHANNELS = new Set<string>(['usageFloat:get', 'usageFloat:set', 'usageFloat:close'])

/** Pure decision the registrar enforces: may a sender with this role call
 * `channel`? An unknown sender (`undefined`) can call nothing. */
export function isChannelAllowedForRole(channel: string, role: WindowRole | undefined): boolean {
  if (role === 'overlay') return OVERLAY_ALLOWED_CHANNELS.has(channel)
  if (role === 'usage') return USAGE_WIDGET_ALLOWED_CHANNELS.has(channel)
  if (role === 'main') return !OVERLAY_ONLY_CHANNELS.has(channel) && !USAGE_WIDGET_ONLY_CHANNELS.has(channel)
  return false
}
