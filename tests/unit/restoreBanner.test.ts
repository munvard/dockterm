import { describe, it, expect } from 'vitest'
import { RESTORE_BANNER, restoreScrollTail } from '../../src/renderer/src/components/terminal/restoreBanner'

describe('restore banner', () => {
  it('keeps each banner line within 80 columns', () => {
    const lines = RESTORE_BANNER.replace(/\x1b\[[0-9;]*m/g, '').split('\r\n')
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(80)
  })
})

describe('restoreScrollTail', () => {
  it('writes nothing on macOS and Linux, so the prompt follows the banner', () => {
    expect(restoreScrollTail('darwin', 30, 12)).toBe('')
    expect(restoreScrollTail('linux', 30, 12)).toBe('')
  })

  it('on Windows scrolls exactly the used rows up from the bottom row, then homes the cursor for ConPTY', () => {
    expect(restoreScrollTail('win32', 30, 12)).toBe('\x1b[30;1H' + '\n'.repeat(12) + '\x1b[H')
  })

  it('never scrolls more than a screen, and does nothing when the viewport is already empty', () => {
    expect(restoreScrollTail('win32', 24, 40)).toBe('\x1b[24;1H' + '\n'.repeat(24) + '\x1b[H')
    expect(restoreScrollTail('win32', 24, 0)).toBe('')
  })
})
