import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useToastStore } from '@renderer/state/useToastStore'

describe('useToastStore (RU-M1)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('auto-dismisses after the timeout', () => {
    useToastStore.getState().push('hello')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(4200)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('caps the stack, dropping the oldest', () => {
    const s = useToastStore.getState()
    s.push('1')
    s.push('2')
    s.push('3')
    s.push('4')
    s.push('5')
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(4)
    expect(toasts.map((t) => t.message)).toEqual(['2', '3', '4', '5'])
  })

  it('pause cancels the auto-dismiss timer until resume is called', () => {
    useToastStore.getState().push('hello')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().pause(id)
    vi.advanceTimersByTime(10000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    useToastStore.getState().resume(id)
    vi.advanceTimersByTime(4200)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('resume on an already-dismissed toast is a no-op', () => {
    useToastStore.getState().push('hello')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().dismiss(id)
    expect(() => useToastStore.getState().resume(id)).not.toThrow()
    vi.advanceTimersByTime(10000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
