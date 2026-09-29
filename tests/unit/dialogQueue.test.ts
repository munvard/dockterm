import { describe, it, expect } from 'vitest'
import { useDialogStore } from '@renderer/state/useDialogStore'

describe('useDialogStore queue', () => {
  it('a second confirm() while one is open queues instead of dropping the first promise', async () => {
    const store = useDialogStore.getState()
    const first = store.confirm({ title: 'first', message: 'm1' })
    const second = store.confirm({ title: 'second', message: 'm2' })

    // The second call must not have replaced the first dialog.
    expect(useDialogStore.getState().confirmState?.title).toBe('first')

    useDialogStore.getState().resolveConfirm(true)
    expect(await first).toBe(true)

    // Resolving the first shows the queued second one.
    expect(useDialogStore.getState().confirmState?.title).toBe('second')
    useDialogStore.getState().resolveConfirm(false)
    expect(await second).toBe(false)
    expect(useDialogStore.getState().confirmState).toBeNull()
  })

  it('a prompt() queued behind an open confirm() is shown after it resolves', async () => {
    const store = useDialogStore.getState()
    const c = store.confirm({ title: 'confirm-first', message: 'm' })
    const p = store.prompt({ title: 'prompt-second' })

    expect(useDialogStore.getState().promptState).toBeNull()
    useDialogStore.getState().resolveConfirm(true)
    expect(await c).toBe(true)

    expect(useDialogStore.getState().promptState?.title).toBe('prompt-second')
    useDialogStore.getState().resolvePrompt('answer')
    expect(await p).toBe('answer')
  })
})
