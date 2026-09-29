import { describe, it, expect } from 'vitest'
import { isChannelAllowedForSender } from '@main/ipc/overlayChannels'

describe('isChannelAllowedForSender', () => {
  it('allows any channel for a non-overlay (main window) sender', () => {
    expect(isChannelAllowedForSender('fs:readFile', false)).toBe(true)
    expect(isChannelAllowedForSender('git:status', false)).toBe(true)
    expect(isChannelAllowedForSender('pty:write', false)).toBe(true)
    expect(isChannelAllowedForSender('munu:report', false)).toBe(true)
  })

  it('allows the munu:*, settings:get/set, app:getInfo, and activity:get channels for the overlay', () => {
    const allowed = [
      'munu:report',
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
    ]
    for (const channel of allowed) {
      expect(isChannelAllowedForSender(channel, true)).toBe(true)
    }
  })

  it('blocks fs/git/pty/project channels for the overlay', () => {
    const blocked = ['fs:readFile', 'fs:writeFile', 'git:status', 'pty:write', 'pty:kill', 'project:setActiveRoot']
    for (const channel of blocked) {
      expect(isChannelAllowedForSender(channel, true)).toBe(false)
    }
  })
})
