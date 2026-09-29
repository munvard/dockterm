/**
 * View > Reload and Force Reload tear the page down, and the window's teardown
 * kills every pty it owns. With live terminals (a running Claude session) that
 * must not happen without asking. Pure so the decision is unit-tested.
 */
export interface ReloadGuardDeps {
  /** How many ptys the window owns right now. */
  liveTerminals: () => number
  /** Ask the user; true = go ahead. */
  confirm: (count: number) => Promise<boolean>
  reload: (ignoreCache: boolean) => void
}

export async function guardedReload(deps: ReloadGuardDeps, ignoreCache: boolean): Promise<boolean> {
  const n = deps.liveTerminals()
  if (n > 0 && !(await deps.confirm(n))) return false
  deps.reload(ignoreCache)
  return true
}

export function reloadWarning(count: number): { message: string; detail: string } {
  return {
    message: 'Reload this window?',
    detail: `${count} terminal${count === 1 ? '' : 's'}, including any running Claude sessions, will be closed.`
  }
}
