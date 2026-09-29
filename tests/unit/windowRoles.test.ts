import { describe, it, expect, beforeEach } from 'vitest'
import { registerWindowRole, unregisterWindowRole, roleOf, windowIdsWithRole } from '@main/ipc/windowRoles'
import { projectForOverlay, overlayPatchSchema } from '@main/services/overlaySettings'
import { DEFAULT_SETTINGS } from '@main/services/settingsService'

describe('window roles', () => {
  beforeEach(() => {
    for (const id of [...windowIdsWithRole('main'), ...windowIdsWithRole('overlay')]) unregisterWindowRole(id)
  })

  it('an unregistered sender has no role', () => {
    expect(roleOf(999)).toBeUndefined()
    expect(roleOf(undefined)).toBeUndefined()
  })

  it('records a role once and keeps it', () => {
    registerWindowRole(1, 'main')
    registerWindowRole(1, 'main')
    expect(roleOf(1)).toBe('main')
    expect(() => registerWindowRole(1, 'overlay')).toThrow()
    expect(roleOf(1)).toBe('main')
  })

  it('a destroyed overlay id does not turn into a main window', () => {
    registerWindowRole(7, 'overlay')
    unregisterWindowRole(7)
    expect(roleOf(7)).toBeUndefined()
  })

  it('lists ids by role', () => {
    registerWindowRole(1, 'main')
    registerWindowRole(2, 'overlay')
    registerWindowRole(3, 'main')
    expect(windowIdsWithRole('main').sort()).toEqual([1, 3])
    expect(windowIdsWithRole('overlay')).toEqual([2])
  })
})

describe('overlay settings subset', () => {
  it('projects only the munu section and the swarm flag', () => {
    const full = {
      ...DEFAULT_SETTINGS,
      notes: 'secret notes',
      lastProjectPath: '/home/me/private',
      recentProjects: [{ path: '/home/me/private', name: 'private', lastOpenedAt: 1 }],
      workspace: { tabs: [], activeId: 'x', projectPath: '/home/me/private' }
    }
    const out = projectForOverlay(full)
    expect(Object.keys(out).sort()).toEqual(['agentActivity', 'munu'])
    expect(out.agentActivity).toEqual({ swarm: DEFAULT_SETTINGS.agentActivity.swarm })
    expect(out.munu).toEqual(DEFAULT_SETTINGS.munu)
    expect(JSON.stringify(out)).not.toContain('private')
    expect(JSON.stringify(out)).not.toContain('secret')
  })

  it('the overlay may patch munu fields, partially', () => {
    expect(overlayPatchSchema.parse({ munu: { pinned: true } })).toEqual({ munu: { pinned: true } })
    expect(overlayPatchSchema.safeParse({ munu: { size: 9999 } }).success).toBe(false)
  })

  it('the overlay may not patch anything else', () => {
    expect(overlayPatchSchema.safeParse({ notes: 'x' }).success).toBe(false)
    expect(overlayPatchSchema.safeParse({ munu: { pinned: true }, notes: 'x' }).success).toBe(false)
    expect(overlayPatchSchema.safeParse({ workspace: null }).success).toBe(false)
    expect(overlayPatchSchema.safeParse({ terminal: { fontSize: 20 } }).success).toBe(false)
    expect(overlayPatchSchema.safeParse({ munu: { pinned: true }, agentActivity: { swarm: false } }).success).toBe(false)
  })
})
