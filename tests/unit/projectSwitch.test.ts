import { afterEach, describe, expect, it } from 'vitest'
import { useDialogStore } from '@renderer/state/useDialogStore'
import {
  askProjectSwitch,
  isSameProjectPath,
  setLiveTerminalCounter,
  switchDialogBody
} from '@renderer/state/projectSwitch'

afterEach(() => setLiveTerminalCounter(null))

/** Wait until the dialog is up, then answer it. */
async function answer(value: string): Promise<void> {
  for (let i = 0; i < 20 && !useDialogStore.getState().choiceState; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
  useDialogStore.getState().resolveChoice(value)
}

describe('switchDialogBody', () => {
  it('states the terminal and Claude counts', () => {
    expect(switchDialogBody({ terminals: 3, claude: 2 })).toBe(
      'This window has 3 terminals (2 running Claude). Opening another project here closes them.'
    )
    expect(switchDialogBody({ terminals: 1, claude: 0 })).toContain('1 terminal (0 running Claude)')
  })
})

describe('askProjectSwitch', () => {
  it('does not ask when no pane has a live PTY', async () => {
    setLiveTerminalCounter(async () => ({ terminals: 0, claude: 0 }))
    expect(await askProjectSwitch('/work/app')).toBe('proceed')
    expect(useDialogStore.getState().choiceState).toBeNull()
  })

  it('does not ask before a counter is registered', async () => {
    expect(await askProjectSwitch('/work/app')).toBe('proceed')
  })

  it('shows Open <name>? with three buttons, new window first (the default)', async () => {
    setLiveTerminalCounter(async () => ({ terminals: 2, claude: 1 }))
    const decision = askProjectSwitch('/work/my-app')
    for (let i = 0; i < 20 && !useDialogStore.getState().choiceState; i++) {
      await new Promise((r) => setTimeout(r, 0))
    }
    const state = useDialogStore.getState().choiceState
    expect(state?.title).toBe('Open my-app?')
    expect(state?.message).toBe(
      'This window has 2 terminals (1 running Claude). Opening another project here closes them.'
    )
    expect(state?.choices.map((c) => c.label)).toEqual(['Open in new window', 'Replace', 'Cancel'])
    expect(state?.dismissValue).toBe('cancel')
    useDialogStore.getState().resolveChoice('new-window')
    expect(await decision).toBe('new-window')
  })

  it('maps Replace to proceed and Cancel / Esc to cancel', async () => {
    setLiveTerminalCounter(async () => ({ terminals: 1, claude: 0 }))
    const replace = askProjectSwitch('/a')
    await answer('replace')
    expect(await replace).toBe('proceed')

    const cancel = askProjectSwitch('/a')
    await answer('cancel')
    expect(await cancel).toBe('cancel')
  })
})

describe('isSameProjectPath', () => {
  it('ignores a trailing slash and separator style, nothing else', () => {
    expect(isSameProjectPath('/a/b', '/a/b/')).toBe(true)
    expect(isSameProjectPath('C:\\a\\b', 'C:/a/b')).toBe(true)
    expect(isSameProjectPath('/a/b', '/a/c')).toBe(false)
    expect(isSameProjectPath('/a/b', '/a/B')).toBe(false)
  })
})
