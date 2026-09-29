import { describe, it, expect, beforeEach } from 'vitest'
import { isModalOpen, modalRegistry } from '@renderer/state/modalState'
import { useDialogStore } from '@renderer/state/useDialogStore'

describe('isModalOpen (I1, minor 11: shortcuts must not act under an overlay)', () => {
  beforeEach(() => {
    useDialogStore.setState({ confirmState: null, promptState: null, choiceState: null })
  })

  it('is false with nothing open', () => {
    expect(isModalOpen()).toBe(false)
  })

  it('is true while a confirm, prompt or choice dialog is queued', () => {
    const resolve = (): void => {}
    useDialogStore.setState({ confirmState: { title: '', message: '', resolve } })
    expect(isModalOpen()).toBe(true)
    useDialogStore.setState({ confirmState: null, choiceState: { title: '', message: '', choices: [], dismissValue: '', resolve } })
    expect(isModalOpen()).toBe(true)
  })

  it('is true while any <Modal> is mounted (UpdatePopup, Compose) and after it leaves is false again', () => {
    modalRegistry.enter()
    expect(isModalOpen()).toBe(true)
    modalRegistry.leave()
    expect(isModalOpen()).toBe(false)
  })
})
