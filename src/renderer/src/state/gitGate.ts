import type { InvokeChannel, ReqOf, ResOf } from '@shared/ipc'
import { err } from '@shared/result'
import { useDialogStore } from './useDialogStore'

export interface UntrustedConfigDetails {
  root: string
  entries: { key: string; value: string }[]
}

/** Narrow the untyped `details` main attaches to an UNTRUSTED_GIT_CONFIG error. */
export function parseUntrustedDetails(details: unknown): UntrustedConfigDetails | null {
  if (!details || typeof details !== 'object') return null
  const d = details as { root?: unknown; entries?: unknown }
  if (typeof d.root !== 'string' || !Array.isArray(d.entries)) return null
  const entries: { key: string; value: string }[] = []
  for (const e of d.entries) {
    if (!e || typeof e !== 'object') return null
    const { key, value } = e as { key?: unknown; value?: unknown }
    if (typeof key !== 'string' || typeof value !== 'string') return null
    entries.push({ key, value })
  }
  return { root: d.root, entries }
}

/**
 * Invoke a user-initiated git write / network channel. If main refuses because
 * the repo's own .git/config would make git run commands, show what those are
 * and let the user decide. "Run anyway" trusts the repo for this app session and
 * retries the action exactly once; Cancel resolves to a CANCELED error (callers
 * must not toast it).
 */
export async function invokeGitGated<C extends InvokeChannel>(
  channel: C,
  req: ReqOf<C>
): Promise<ResOf<C>> {
  const res = await window.dockterm.invoke(channel, req)
  if (res.ok || res.error.code !== 'UNTRUSTED_GIT_CONFIG') return res
  const details = parseUntrustedDetails(res.error.details)
  if (!details) return res
  const run = await useDialogStore.getState().confirm({
    title: "This repo's git config runs commands",
    message: 'Git will run these commands from the repository’s own .git/config when you continue:',
    detail: 'Only continue if you trust this repository.',
    command: details.entries.map((e) => `${e.key} = ${e.value}`).join('\n'),
    confirmLabel: 'Run anyway',
    cancelLabel: 'Cancel',
    danger: true
  })
  if (!run) return err('CANCELED', 'Canceled') as ResOf<C>
  const trusted = await window.dockterm.invoke('git:trustRepo', { root: details.root })
  if (!trusted.ok) return trusted as ResOf<C>
  return window.dockterm.invoke(channel, req)
}
