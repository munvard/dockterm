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

  it('choose() resolves to the clicked one of three buttons', async () => {
    const choices = [
      { value: 'new-window', label: 'Open in new window' },
      { value: 'replace', label: 'Replace' },
      { value: 'cancel', label: 'Cancel', kind: 'ghost' as const }
    ]
    const picked = useDialogStore
      .getState()
      .choose({ title: 't', message: 'm', choices, dismissValue: 'cancel' })
    expect(useDialogStore.getState().choiceState?.choices).toHaveLength(3)
    useDialogStore.getState().resolveChoice('replace')
    expect(await picked).toBe('replace')
    expect(useDialogStore.getState().choiceState).toBeNull()
  })

  it('a choose() queues behind an open confirm() and shows after it, and vice versa', async () => {
    const choices = [{ value: 'a', label: 'A' }]
    const c = useDialogStore.getState().confirm({ title: 'c', message: 'm' })
    const ch = useDialogStore
      .getState()
      .choose({ title: 'ch', message: 'm', choices, dismissValue: 'a' })
    const c2 = useDialogStore.getState().confirm({ title: 'c2', message: 'm' })
    expect(useDialogStore.getState().choiceState).toBeNull()

    useDialogStore.getState().resolveConfirm(true)
    expect(await c).toBe(true)
    expect(useDialogStore.getState().choiceState?.title).toBe('ch')
    expect(useDialogStore.getState().confirmState).toBeNull()

    useDialogStore.getState().resolveChoice('a')
    expect(await ch).toBe('a')
    expect(useDialogStore.getState().confirmState?.title).toBe('c2')
    useDialogStore.getState().resolveConfirm(false)
    expect(await c2).toBe(false)
  })
})
