/**
 * Which kind of window each webContents is, recorded ONCE when main creates the
 * window. The registrar decides what a sender may call from this, never from
 * "is it the live overlay right now": a sender that was never registered (a
 * window main did not create, or one that is gone) is unknown and is refused.
 * No electron import, so it is unit-testable.
 */
export type WindowRole = 'main' | 'overlay'

const roles = new Map<number, WindowRole>()

/** Roles are immutable: re-registering with the same role is a no-op, with a
 * different one throws. */
export function registerWindowRole(id: number, role: WindowRole): void {
  const existing = roles.get(id)
  if (existing !== undefined && existing !== role) {
    throw new Error(`webContents ${id} is already registered as ${existing}`)
  }
  roles.set(id, role)
}

export function unregisterWindowRole(id: number): void {
  roles.delete(id)
}

export function roleOf(id: number | undefined): WindowRole | undefined {
  return id === undefined ? undefined : roles.get(id)
}

export function windowIdsWithRole(role: WindowRole): number[] {
  return [...roles].filter(([, r]) => r === role).map(([id]) => id)
}
