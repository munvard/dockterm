import type { MouseEvent } from 'react'

/** Controls inside the top bar and tab strip that own their double-click. */
const CONTROLS =
  'button, a, input, select, textarea, [role="button"], [role="menu"], .tab, .notes, .ctxmenu, .grid-menu, .launcher-menu'

/** Double-click on the empty top bar or tab strip: zoom (or whatever the macOS
 * setting says) like a native title bar. Windows does this itself for drag
 * regions, and Linux keeps its native frame, so only macOS asks main. */
export function onChromeDoubleClick(e: MouseEvent): void {
  if (document.documentElement.dataset.platform !== 'darwin') return
  if ((e.target as Element).closest(CONTROLS)) return
  void window.dockterm.invoke('window:titleDoubleClick', undefined)
}
