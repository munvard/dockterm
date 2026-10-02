import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({ protocol: {}, net: {}, app: { isPackaged: true } }))

import { APP_URL, OVERLAY_URL, USAGE_WIDGET_URL } from '@main/protocol'

describe('window hosts', () => {
  it('main, overlay and usage widget each load from their own host (zoom is kept per host)', () => {
    const hosts = [APP_URL, OVERLAY_URL, USAGE_WIDGET_URL].map((u) => new URL(u).host)
    expect(new Set(hosts).size).toBe(3)
    expect(new URL(USAGE_WIDGET_URL).pathname).toBe('/usage-widget.html')
  })
})
