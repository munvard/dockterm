import { BrowserWindow } from 'electron'
import type { Settings } from '@shared/types'
import { roleOf } from '../ipc/windowRoles'
import { projectForOverlay } from './overlaySettings'
import { usageFloatView } from '../usageFloatCore'

/** Push new settings to every window by ITS role: main windows get the full
 * settings, the overlay gets only its munu / swarm subset, and a window with no
 * registered role gets nothing.
 *
 * `workspace` is per-window session state (which window's saved workspace gets
 * restored is decided by projectPath matching in the renderer, not by which
 * window happens to receive this broadcast), and it is also the largest field in
 * a broadcast that fires on every preference change, so it never rides along. */
export function broadcastSettings(next: Settings): void {
  const shared = { ...next, workspace: null }
  const overlay = projectForOverlay(next)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    const role = roleOf(win.webContents.id)
    if (role === 'main') win.webContents.send('settings:changed', shared)
    else if (role === 'overlay') win.webContents.send('overlaySettings:changed', overlay)
    else if (role === 'usage') win.webContents.send('usageFloat:changed', usageFloatView(next))
  }
}
