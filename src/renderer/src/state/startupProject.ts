/**
 * Which project a starting window opens: a folder the OS asked for (Finder
 * "Open With" on a cold start) wins over the remembered last project, and only
 * the primary window restores anything. Null means "show the welcome screen".
 */
export function pickStartupProject(
  pending: string | null,
  last: string | null | undefined,
  isPrimary: boolean
): string | null {
  if (!isPrimary) return null
  return pending || last || null
}
