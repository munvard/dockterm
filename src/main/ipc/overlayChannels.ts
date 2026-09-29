/**
 * The munu overlay is a much smaller, always-on-top surface than the main
 * window, and has no business calling fs/git/pty/project channels even
 * though it's an equally "trusted" (app://) renderer — it should only ever
 * reach the handlers its own UI actually invokes. register.ts checks this by
 * webContents id against the live overlay window rather than by adding an
 * `allow` option to every handler registration, so every OTHER wave's
 * handler file needs zero changes to get this restriction; a channel a
 * future overlay feature needs is opted in here, in one place.
 *
 * Split into its own module (no electron import) so the allowlist logic is
 * unit-testable without pulling in the entire handler-registration graph.
 */
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
  'settings:get',
  'settings:set',
  'app:getInfo',
  'activity:get'
])

/** Pure decision the registrar enforces: is `channel` reachable from this
 * sender? */
export function isChannelAllowedForSender(channel: string, senderIsOverlay: boolean): boolean {
  return !senderIsOverlay || OVERLAY_ALLOWED_CHANNELS.has(channel)
}
