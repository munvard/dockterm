import { describe, expect, it } from 'vitest'
import { samePaneStatus, useMunuStore } from '@renderer/state/useMunuStore'
import type { AskInfo } from '@shared/types'

const ask = (cursorRow: number): AskInfo => ({
  title: 'Allow?',
  options: ['Yes', 'No'],
  descriptions: [null, null],
  steps: [],
  binary: true,
  multiSelect: false,
  checkable: [false, false],
  checked: [false, false],
  submitIndex: null,
  cursorRow
})

describe('samePaneStatus', () => {
  it('treats an identical re-report as unchanged and any visible difference as a change', () => {
    const base = { state: 'asking' as const, ask: ask(0), tabId: 't1' }
    expect(samePaneStatus(undefined, base)).toBe(false)
    expect(samePaneStatus(base, { ...base, ask: ask(0) })).toBe(true)
    expect(samePaneStatus(base, { ...base, ask: ask(1) })).toBe(false)
    expect(samePaneStatus(base, { ...base, tabId: 't2' })).toBe(false)
    expect(samePaneStatus(base, { ...base, state: 'working', ask: null })).toBe(false)
    const idle = { state: 'idle' as const, ask: null, tabId: 't1' }
    expect(samePaneStatus(idle, { ...idle })).toBe(true)
  })

  it('setPaneStatus keeps the same panes object when nothing changed', () => {
    const st = useMunuStore.getState()
    st.setPaneStatus('leaf-x', 't1', 'working', null)
    const before = useMunuStore.getState().panes
    st.setPaneStatus('leaf-x', 't1', 'working', null)
    expect(useMunuStore.getState().panes).toBe(before)
    st.setPaneStatus('leaf-x', 't1', 'idle', null)
    expect(useMunuStore.getState().panes).not.toBe(before)
    st.removePane('leaf-x')
  })
})
