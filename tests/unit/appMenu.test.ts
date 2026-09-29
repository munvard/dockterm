import { describe, it, expect } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildMenuTemplate } from '@main/services/appMenuTemplate'
import { guardedReload, reloadWarning } from '@main/services/reloadGuard'

const deps = {
  appName: 'DockTerm',
  send: () => {},
  newWindow: () => {},
  openExternal: () => {},
  reload: () => {}
}

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  const walk = (list: MenuItemConstructorOptions[]): void => {
    for (const it of list) {
      out.push(it)
      if (Array.isArray(it.submenu)) walk(it.submenu)
    }
  }
  walk(template)
  return out
}

/** Roles whose win/linux default accelerator is NOT a plain Ctrl+letter. */
const SAFE_ROLES = new Set([
  'toggleDevTools', // Ctrl+Shift+I
  'togglefullscreen', // F11
  'help',
  'zoom'
])

const find = (t: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions => {
  const it = items(t).find((i) => i.label === label)
  if (!it) throw new Error(`no menu item ${label}`)
  return it
}

describe.each(['win32', 'linux'] as const)('app menu on %s', (platform) => {
  const all = items(buildMenuTemplate(platform, deps))

  it('registers no plain Ctrl+<letter> accelerator', () => {
    for (const it of all) {
      if (it.registerAccelerator === false) continue
      if (it.accelerator) {
        expect(String(it.accelerator), String(it.label)).toMatch(/^Ctrl\+Shift\+/)
      } else if (it.role) {
        expect(SAFE_ROLES.has(it.role), `role ${it.role} would default to a plain Ctrl key`).toBe(true)
      }
    }
  })

  it('uses the Ctrl+Shift scheme for the app shortcuts, and shows the real key', () => {
    const t = buildMenuTemplate(platform, deps)
    expect(find(t, 'New Tab').accelerator).toBe('Ctrl+Shift+T')
    expect(find(t, 'New Window').accelerator).toBe('Ctrl+Shift+N')
    expect(find(t, 'Open Project…').accelerator).toBe('Ctrl+Shift+O')
    expect(find(t, 'Split Right').accelerator).toBe('Ctrl+Shift+D')
  })

  it('never registers a key the renderer already handles', () => {
    const t = buildMenuTemplate(platform, deps)
    for (const label of ['New Tab', 'New Window', 'Open Project…', 'Split Right', 'Settings…']) {
      expect(find(t, label).registerAccelerator, label).toBe(false)
    }
  })

  it('never registers plain Ctrl+0 / Ctrl+Plus / Ctrl+- (terminal keys); zoom hints show Ctrl+Shift', () => {
    const zoom = all.filter((i) => ['resetZoom', 'zoomIn', 'zoomOut'].includes(String(i.role)))
    expect(zoom).toHaveLength(3)
    for (const z of zoom) {
      expect(z.registerAccelerator, String(z.role)).toBe(false)
      expect(String(z.accelerator)).toMatch(/^Ctrl\+Shift\+/)
    }
  })

  it('has no Close Tab hint (Ctrl+Shift+W closes a pane) and no reload key that collides with chat toggle', () => {
    const t = buildMenuTemplate(platform, deps)
    expect(find(t, 'Close Tab').accelerator).toBeUndefined()
    expect(all.some((i) => i.role === 'reload' || i.role === 'forceReload')).toBe(false)
  })
})

describe('app menu on darwin', () => {
  const t = buildMenuTemplate('darwin', deps)

  it('uses Cmd for the app shortcuts, unregistered because the renderer owns them', () => {
    for (const [label, key] of [
      ['New Tab', 'Cmd+T'],
      ['New Window', 'Cmd+N'],
      ['Open Project…', 'Cmd+O'],
      ['Split Right', 'Cmd+D']
    ]) {
      const it = find(t, label)
      expect(it.accelerator, label).toBe(key)
      expect(it.registerAccelerator, label).toBe(false)
    }
  })
})

describe('View > Reload goes through the guard (I6)', () => {
  it('Reload and Force Reload call deps.reload instead of reloading directly', () => {
    const calls: [unknown, boolean][] = []
    const t = buildMenuTemplate('darwin', { ...deps, reload: (w, ic) => calls.push([w, ic]) })
    const win = {} as never
    find(t, 'Reload').click?.({} as never, win, {} as never)
    find(t, 'Force Reload').click?.({} as never, win, {} as never)
    expect(calls).toEqual([
      [win, false],
      [win, true]
    ])
  })
})

describe('guardedReload', () => {
  const mk = (n: number, answer: boolean) => {
    const log: string[] = []
    return {
      log,
      deps: {
        liveTerminals: () => n,
        confirm: async (c: number) => (log.push(`confirm:${c}`), answer),
        reload: (ic: boolean) => log.push(`reload:${ic}`)
      }
    }
  }
  it('reloads at once with no live terminal', async () => {
    const h = mk(0, false)
    expect(await guardedReload(h.deps, false)).toBe(true)
    expect(h.log).toEqual(['reload:false'])
  })
  it('asks first when terminals are live, and does nothing on Cancel', async () => {
    const h = mk(2, false)
    expect(await guardedReload(h.deps, true)).toBe(false)
    expect(h.log).toEqual(['confirm:2'])
  })
  it('reloads after the user confirms', async () => {
    const h = mk(1, true)
    expect(await guardedReload(h.deps, true)).toBe(true)
    expect(h.log).toEqual(['confirm:1', 'reload:true'])
  })
  it('words the warning with the count', () => {
    expect(reloadWarning(1).detail).toMatch(/^1 terminal,/)
    expect(reloadWarning(3).detail).toMatch(/^3 terminals,/)
  })
})
