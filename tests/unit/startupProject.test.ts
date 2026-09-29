import { describe, it, expect } from 'vitest'
import { pickStartupProject } from '@renderer/state/startupProject'
import { setPendingOpen, takePendingOpen } from '@main/services/pendingOpen'

describe('pickStartupProject (I9: Open With on a cold start)', () => {
  it('the requested folder beats the last project', () => {
    expect(pickStartupProject('/folder/x', '/last', true)).toBe('/folder/x')
  })

  it('falls back to the last project, then to the welcome screen', () => {
    expect(pickStartupProject(null, '/last', true)).toBe('/last')
    expect(pickStartupProject(null, undefined, true)).toBeNull()
  })

  it('a secondary window opens nothing', () => {
    expect(pickStartupProject('/folder/x', '/last', false)).toBeNull()
  })
})

describe('pendingOpen', () => {
  it('hands the folder over once, then is empty', () => {
    expect(takePendingOpen()).toBeNull()
    setPendingOpen('/folder/x')
    expect(takePendingOpen()).toBe('/folder/x')
    expect(takePendingOpen()).toBeNull()
  })
})
