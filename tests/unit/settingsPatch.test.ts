import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettingsPatch, settingsPatchSchema } from '@main/services/settingsService'
import type { Settings } from '@shared/types'

const base = (): Settings => ({
  ...DEFAULT_SETTINGS,
  terminal: { ...DEFAULT_SETTINGS.terminal, fontSize: 20, scrollback: 9000, lineHeight: 1.4 },
  ui: { ...DEFAULT_SETTINGS.ui, zoom: 1.5, dockWidth: 400 },
  munu: { ...DEFAULT_SETTINGS.munu, size: 80, pinned: true, position: { x: 10, y: 20 } },
  claude: { ...DEFAULT_SETTINGS.claude, paths: { skills: '/s', commands: '/c', agents: '/a', mcpConfig: '/m' } }
})

const patch = (raw: unknown) => settingsPatchSchema.parse(raw)

describe('settings patch schema', () => {
  it('does not fill defaults for fields the patch omits', () => {
    expect(patch({ terminal: { cursorStyle: 'bar' } })).toEqual({ terminal: { cursorStyle: 'bar' } })
    expect(patch({ munu: { sounds: false } })).toEqual({ munu: { sounds: false } })
    expect(patch({})).toEqual({})
  })

  it('still validates the fields it does name', () => {
    expect(settingsPatchSchema.safeParse({ terminal: { fontSize: 3 } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ munu: { size: 500 } }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ ui: { accent: 'pink' } }).success).toBe(false)
  })
})

describe('mergeSettingsPatch', () => {
  it('a partial section never resets its sibling fields', () => {
    const next = mergeSettingsPatch(base(), patch({ terminal: { cursorStyle: 'bar' } }))
    expect(next.terminal.cursorStyle).toBe('bar')
    expect(next.terminal.fontSize).toBe(20)
    expect(next.terminal.scrollback).toBe(9000)
    expect(next.terminal.lineHeight).toBe(1.4)
  })

  it('leaves untouched sections exactly as they were', () => {
    const cur = base()
    const next = mergeSettingsPatch(cur, patch({ terminal: { cursorStyle: 'bar' } }))
    expect(next.ui).toEqual(cur.ui)
    expect(next.munu).toEqual(cur.munu)
    expect(next.notes).toBe(cur.notes)
    expect(next.checkpoints).toEqual(cur.checkpoints)
  })

  it('merges a nested object field by field', () => {
    const next = mergeSettingsPatch(base(), patch({ claude: { paths: { skills: '/new' } } }))
    expect(next.claude.paths).toEqual({ skills: '/new', commands: '/c', agents: '/a', mcpConfig: '/m' })
  })

  it('two partial patches from different fields both survive', () => {
    const a = mergeSettingsPatch(base(), patch({ ui: { zoom: 1.2 } }))
    const b = mergeSettingsPatch(a, patch({ ui: { dockWidth: 300 } }))
    expect(b.ui.zoom).toBe(1.2)
    expect(b.ui.dockWidth).toBe(300)
  })

  it('a full-section snapshot still works', () => {
    const cur = base()
    const next = mergeSettingsPatch(cur, patch({ munu: { ...cur.munu, pinned: false } }))
    expect(next.munu).toEqual({ ...cur.munu, pinned: false })
  })

  it('null replaces a nullable field', () => {
    const next = mergeSettingsPatch(base(), patch({ munu: { position: null } }))
    expect(next.munu.position).toBeNull()
    expect(next.munu.size).toBe(80)
  })

  it('a workspace snapshot replaces the old one whole', () => {
    const cur = mergeSettingsPatch(
      base(),
      patch({ workspace: { tabs: [{ id: 't1', title: 'one', layout: {}, focusedLeafId: 'l1' }], activeId: 't1', projectPath: '/p' } })
    )
    const next = mergeSettingsPatch(
      cur,
      patch({ workspace: { tabs: [{ id: 't2', title: 'two', layout: {}, focusedLeafId: 'l2' }], activeId: 't2' } })
    )
    expect(next.workspace?.tabs.map((t) => t.id)).toEqual(['t2'])
    expect(next.workspace?.projectPath).toBeUndefined()
    expect(mergeSettingsPatch(next, patch({ workspace: null })).workspace).toBeNull()
  })

  it('rejects a result that is not valid as a whole (position with only x)', () => {
    const cur = { ...base(), munu: { ...base().munu, position: null } }
    expect(() => mergeSettingsPatch(cur, patch({ munu: { position: { x: 1 } } }))).toThrow()
  })

  it('does not mutate the current settings', () => {
    const cur = base()
    const snapshot = JSON.stringify(cur)
    mergeSettingsPatch(cur, patch({ terminal: { fontSize: 30 }, claude: { paths: { skills: '/x' } } }))
    expect(JSON.stringify(cur)).toBe(snapshot)
  })

  it('sets theme and notes', () => {
    const next = mergeSettingsPatch(base(), patch({ theme: 'x', notes: 'n' }))
    expect(next.theme).toBe('x')
    expect(next.notes).toBe('n')
  })
})

describe('usage settings (real usage capture)', () => {
  it('defaults: Claude numbers, capture on, pill shows the 5-hour window, float off', () => {
    const u = DEFAULT_SETTINGS.usage
    expect(u.source).toBe('claude')
    expect(u.captureEnabled).toBe(true)
    expect(u.pill).toEqual({ show: ['fiveHour'], style: 'percent', showReset: true, warnAt: 75, critAt: 90 })
    expect(u.float).toMatchObject({ enabled: false, x: null, y: null, w: 260, h: 120, alwaysOnTop: true, opacity: 1, show: ['fiveHour', 'sevenDay'], style: 'percent', showReset: true })
  })

  it('an old config without the new leaves is filled with the defaults', () => {
    const parsed = settingsPatchSchema.parse({ usage: { source: 'local' } })
    expect(parsed).toEqual({ usage: { source: 'local' } })
    const next = mergeSettingsPatch(base(), parsed)
    expect(next.usage.source).toBe('local')
    expect(next.usage.captureEnabled).toBe(true)
    expect(next.usage.float.w).toBe(260)
  })

  it('a partial pill / float patch never resets the sibling fields', () => {
    const next = mergeSettingsPatch(base(), patch({ usage: { pill: { style: 'ring' }, float: { enabled: true, x: 10, y: 20 } } }))
    expect(next.usage.pill.style).toBe('ring')
    expect(next.usage.pill.warnAt).toBe(75)
    expect(next.usage.float).toMatchObject({ enabled: true, x: 10, y: 20, w: 260, opacity: 1 })
  })

  it('rejects out-of-range or unknown values', () => {
    for (const bad of [
      { usage: { source: 'guess' } },
      { usage: { pill: { style: 'pie' } } },
      { usage: { pill: { show: ['tokens'] } } },
      { usage: { float: { opacity: 0.1 } } },
      { usage: { float: { w: 10 } } },
      { usage: { captureEnabled: 'yes' } }
    ]) expect(settingsPatchSchema.safeParse(bad).success).toBe(false)
  })
})
