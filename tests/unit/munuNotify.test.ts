import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Notification + overlay-raise behaviour of munuService.
 *
 * Regression guard for the Linux bug where the always-on-top munu overlay could
 * be granted focus by the compositor while DockTerm was backgrounded, which made
 * maybeNotify() think the app was focused and silently drop every notification.
 * Also covers the best-effort overlay raise fired on a fresh `asking`.
 *
 * Driven through the public reportMunu() entry point so we exercise the real
 * pushGlobal() → maybeNotify() path.
 */

const m = vi.hoisted(() => {
  const win = () => ({
    _focused: false,
    isFocused(): boolean {
      return this._focused
    },
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    moveTop: vi.fn(),
    webContents: { send: vi.fn() }
  })
  const mainWin = win()
  const overlayWin = win()
  const NotificationCtor = vi.fn(function (this: { show: () => void }) {
    this.show = vi.fn()
  }) as unknown as { (): void; isSupported: () => boolean } & ReturnType<typeof vi.fn>
  ;(NotificationCtor as unknown as { isSupported: () => boolean }).isSupported = () => true
  const settings = {
    munu: { notifications: true, sounds: true, pinned: false, keepAwake: false, enabled: true, overlay: true }
  }
  const reassertOverlayLevel = vi.fn()
  return { mainWin, overlayWin, NotificationCtor, settings, reassertOverlayLevel }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [m.mainWin, m.overlayWin] },
  Notification: m.NotificationCtor,
  powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
  screen: {
    getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 })
  },
  webContents: { fromId: () => undefined }
}))

vi.mock('@main/overlayWindow', () => ({
  createOverlayWindow: vi.fn(),
  destroyOverlay: vi.fn(),
  getOverlay: () => m.overlayWin,
  reassertOverlayLevel: m.reassertOverlayLevel,
  repositionOverlay: vi.fn(),
  resizeOverlay: vi.fn(),
  setOverlayFocusable: vi.fn(),
  setOverlayInteractive: vi.fn()
}))

vi.mock('@main/services/settingsService', () => ({ getSettings: () => m.settings }))

async function loadFresh() {
  vi.resetModules()
  return import('@main/services/munuService')
}

beforeEach(() => {
  m.mainWin._focused = false
  m.overlayWin._focused = false
  m.NotificationCtor.mockClear()
  m.mainWin.moveTop.mockClear()
  m.overlayWin.moveTop.mockClear()
  m.reassertOverlayLevel.mockClear()
  m.settings.munu.notifications = true
})

describe('munuService notifications', () => {
  it('does NOT notify when a real DockTerm window is focused', async () => {
    m.mainWin._focused = true
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.NotificationCtor).not.toHaveBeenCalled()
  })

  it('DOES notify when backgrounded even if the overlay reports focused (DT-001)', async () => {
    // The compositor handed focus to the overlay; the app is still backgrounded.
    m.mainWin._focused = false
    m.overlayWin._focused = true
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.NotificationCtor).toHaveBeenCalledTimes(1)
  })

  it('notifies when fully backgrounded with no window focused', async () => {
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.NotificationCtor).toHaveBeenCalledTimes(1)
  })

  it('does not fire a duplicate notification while the state is unchanged', async () => {
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.NotificationCtor).toHaveBeenCalledTimes(1)
  })

  it('best-effort raises the overlay on a fresh ask (DT-002) without taking focus', async () => {
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.reassertOverlayLevel).toHaveBeenCalledTimes(1)
    expect(m.overlayWin.moveTop).toHaveBeenCalledTimes(1)
    // It must never call focus()/show() on the overlay (that would reintroduce DT-001).
    expect(m.overlayWin.focus).not.toHaveBeenCalled()
    expect(m.overlayWin.show).not.toHaveBeenCalled()
  })

  it('does not raise again while the ask persists (no transition)', async () => {
    const { reportMunu } = await loadFresh()
    reportMunu(1, { state: 'asking', asks: [] })
    reportMunu(1, { state: 'asking', asks: [] })
    expect(m.overlayWin.moveTop).toHaveBeenCalledTimes(1)
  })
})
