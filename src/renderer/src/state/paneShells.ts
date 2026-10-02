/** The shell program each pane's pty started (CreatePtyRes.shell), keyed by leaf id. */
const shells = new Map<string, string>()

export const paneShells = {
  set: (leafId: string, shell: string): void => void shells.set(leafId, shell),
  get: (leafId: string): string => shells.get(leafId) ?? '',
  delete: (leafId: string): void => void shells.delete(leafId)
}
