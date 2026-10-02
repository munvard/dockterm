import { describe, it, expect } from 'vitest'
import { isChannelAllowedForRole } from '@main/ipc/overlayChannels'

describe('isChannelAllowedForRole', () => {
  it('allows any ordinary channel for a main window', () => {
    expect(isChannelAllowedForRole('fs:readFile', 'main')).toBe(true)
    expect(isChannelAllowedForRole('git:status', 'main')).toBe(true)
    expect(isChannelAllowedForRole('pty:write', 'main')).toBe(true)
    expect(isChannelAllowedForRole('munu:report', 'main')).toBe(true)
    expect(isChannelAllowedForRole('settings:get', 'main')).toBe(true)
    expect(isChannelAllowedForRole('settings:set', 'main')).toBe(true)
  })

  it('allows the overlay its munu:*, overlay settings, app:getInfo and activity:get channels', () => {
    const allowed = [
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
    ]
    for (const channel of allowed) {
      expect(isChannelAllowedForRole(channel, 'overlay'), channel).toBe(true)
    }
  })

  it('blocks fs/git/pty/project channels, the full settings and munu:report for the overlay', () => {
    const blocked = [
      'fs:readFile',
      'fs:writeFile',
      'git:status',
      'pty:write',
      'pty:kill',
      'project:setActiveRoot',
      'munu:report',
      'settings:get',
      'settings:set'
    ]
    for (const channel of blocked) {
      expect(isChannelAllowedForRole(channel, 'overlay'), channel).toBe(false)
    }
  })

  it('never lets a main window call the overlay-only channels', () => {
    for (const channel of ['munu:answer', 'overlaySettings:get', 'overlaySettings:set']) {
      expect(isChannelAllowedForRole(channel, 'main'), channel).toBe(false)
    }
  })

  it('fails closed for a sender with no registered role', () => {
    for (const channel of ['fs:readFile', 'settings:get', 'munu:answer', 'app:getInfo', 'pty:write']) {
      expect(isChannelAllowedForRole(channel, undefined), channel).toBe(false)
    }
  })
})

describe('the floating usage window role', () => {
  it('reaches only real usage, history and its own widget channels', () => {
    for (const c of ['usage:realGet', 'usageHistory:get', 'usageFloat:get', 'usageFloat:set', 'usageFloat:close']) {
      expect(isChannelAllowedForRole(c, 'usage'), c).toBe(true)
    }
    for (const c of ['settings:get', 'settings:set', 'fs:readFile', 'pty:write', 'munu:answer', 'git:status']) {
      expect(isChannelAllowedForRole(c, 'usage'), c).toBe(false)
    }
  })
  it('keeps the widget-only channels away from main windows', () => {
    expect(isChannelAllowedForRole('usageFloat:set', 'main')).toBe(false)
    expect(isChannelAllowedForRole('usageHistory:get', 'main')).toBe(true)
    expect(isChannelAllowedForRole('usageFloat:get', 'overlay')).toBe(false)
  })
})

