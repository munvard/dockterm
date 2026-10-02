import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessions = new Map<string, string>()
let notify: () => void = () => {}
const deps = {
  paneSessionId: (leaf: string) => sessions.get(leaf) ?? null,
  onPaneSessionChange: (fn: () => void) => {
    notify = fn
    return () => {
      notify = () => {}
    }
  }
}
vi.stubGlobal('window', { dockterm: { on: () => () => {}, invoke: async () => ({ ok: true, value: null }) } })

import { sameKeys, startMunuDelegatedWith } from '@renderer/state/munuDelegatedCore'
import { useMunuStore } from '@renderer/state/useMunuStore'
import { useAgentStore } from '@renderer/state/useAgentStore'

const setBusyPtys = (busyPtys: string[]): void =>
  useAgentStore.setState({ activity: { busyPtys } as unknown as ReturnType<typeof useAgentStore.getState>['activity'] })

describe('sameKeys', () => {
  it('compares the key sets, not just the counts', () => {
    expect(sameKeys({ a: 1, b: 2 }, { b: 3, a: 4 })).toBe(true)
    expect(sameKeys({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false)
    expect(sameKeys({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe('startMunuDelegated', () => {
  beforeEach(() => {
    sessions.clear()
    useMunuStore.setState({ panes: {}, busy: {} })
  })

  it('follows a pane whose pty changes while the busy pty list stays the same', () => {
    useMunuStore.getState().setPaneStatus('leaf', 't', 'idle', null)
    sessions.set('leaf', 'pty-1')
    setBusyPtys(['pty-2'])
    const stop = startMunuDelegatedWith(deps)
    expect(useMunuStore.getState().busy).toEqual({})
    sessions.set('leaf', 'pty-2') // the shell restarted in the same leaf
    notify()
    expect(useMunuStore.getState().busy).toEqual({ leaf: true })
    sessions.set('leaf', 'pty-3')
    notify()
    expect(useMunuStore.getState().busy).toEqual({})
    stop()
  })

  it('resyncs when one pane closes and another opens (same pane count)', () => {
    sessions.set('b', 'pty-2')
    useMunuStore.getState().setPaneStatus('a', 't', 'idle', null)
    setBusyPtys(['pty-2'])
    const stop = startMunuDelegatedWith(deps)
    useMunuStore.setState({ panes: { b: useMunuStore.getState().panes.a } })
    expect(useMunuStore.getState().busy).toEqual({ b: true })
    stop()
  })
})
