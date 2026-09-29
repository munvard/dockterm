import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok, type Result } from '@shared/result'
import { invokeGitGated, parseUntrustedDetails } from '@renderer/state/gitGate'
import { useDialogStore } from '@renderer/state/useDialogStore'

const details = { root: '/repo', entries: [{ key: 'filter.x.clean', value: 'evil' }] }
const blocked = err('UNTRUSTED_GIT_CONFIG', 'runs commands', details)

function stubInvoke(fn: (channel: string, req: unknown) => Result<unknown>): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string, req: unknown) => fn(channel, req))
  vi.stubGlobal('window', { dockterm: { invoke } })
  return invoke
}

async function waitForDialog(): Promise<NonNullable<ReturnType<typeof useDialogStore.getState>['confirmState']>> {
  for (let i = 0; i < 50 && !useDialogStore.getState().confirmState; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
  const s = useDialogStore.getState().confirmState
  if (!s) throw new Error('no dialog shown')
  return s
}

describe('parseUntrustedDetails', () => {
  it('accepts the shape main sends and rejects anything else', () => {
    expect(parseUntrustedDetails(details)).toEqual(details)
    expect(parseUntrustedDetails(undefined)).toBeNull()
    expect(parseUntrustedDetails({ root: 1, entries: [] })).toBeNull()
    expect(parseUntrustedDetails({ root: '/r', entries: [{ key: 'k' }] })).toBeNull()
  })
})

describe('invokeGitGated', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  it('passes an ordinary result straight through with no dialog', async () => {
    const invoke = stubInvoke(() => ok('done'))
    expect(await invokeGitGated('git:pull', undefined)).toEqual(ok('done'))
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(useDialogStore.getState().confirmState).toBeNull()
  })

  it('shows the keys, and on "Run anyway" trusts the repo and retries once', async () => {
    let calls = 0
    const invoke = stubInvoke((channel) => {
      if (channel === 'git:trustRepo') return ok(undefined)
      calls++
      return calls === 1 ? blocked : ok('staged')
    })
    const pending = invokeGitGated('git:stage', { paths: ['a'] })
    const dialog = await waitForDialog()
    expect(dialog.title).toBe("This repo's git config runs commands")
    expect(dialog.command).toContain('filter.x.clean = evil')
    expect(dialog.confirmLabel).toBe('Run anyway')
    expect(dialog.cancelLabel).toBe('Cancel')
    useDialogStore.getState().resolveConfirm(true)
    expect(await pending).toEqual(ok('staged'))
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['git:stage', 'git:trustRepo', 'git:stage'])
    expect(invoke.mock.calls[1][1]).toEqual({ root: '/repo' })
  })

  it('on Cancel returns CANCELED without trusting or retrying', async () => {
    const invoke = stubInvoke(() => blocked)
    const pending = invokeGitGated('git:push', {})
    await waitForDialog()
    useDialogStore.getState().resolveConfirm(false)
    const res = await pending
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('CANCELED')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('retries only once even if the retry is blocked again', async () => {
    const invoke = stubInvoke((channel) => (channel === 'git:trustRepo' ? ok(undefined) : blocked))
    const pending = invokeGitGated('git:commit', { message: 'm' })
    await waitForDialog()
    useDialogStore.getState().resolveConfirm(true)
    const res = await pending
    expect(res.ok).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
