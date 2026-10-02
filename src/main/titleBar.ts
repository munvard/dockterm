import type { BrowserWindowConstructorOptions } from 'electron'

/** Height of DockTerm's own app bar (`--topbar-h` in tokens.css). The Windows
 * caption buttons are drawn at exactly this height so they sit inside it. */
export const TITLEBAR_HEIGHT = 36

const DEFAULT_COLOR = '#1e1e1d'
const DEFAULT_SYMBOL = '#e6e6e6'

/**
 * Window-frame options per platform. macOS keeps its hidden-inset title bar with
 * traffic lights and vibrancy; Windows hides the native title bar and draws only
 * the caption buttons over DockTerm's own app bar (titleBarOverlay); Linux keeps
 * the native frame.
 */
export function chromeOptions(platform: string): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 13 },
      vibrancy: 'under-window',
      visualEffectState: 'active'
    }
  }
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: DEFAULT_COLOR, symbolColor: DEFAULT_SYMBOL, height: TITLEBAR_HEIGHT }
    }
  }
  return {}
}

/** What a double-click on DockTerm's own title bar areas does on macOS, from the
 * user's "Double-click a window's title bar to" setting (AppleActionOnDoubleClick:
 * "Maximize" (zoom), "Fill", "Minimize" or "None"; unset means zoom). */
export function titleDoubleClickAction(pref: string | undefined): 'zoom' | 'minimize' | 'none' {
  if (pref === 'Minimize') return 'minimize'
  if (pref === 'None') return 'none'
  return 'zoom'
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/
