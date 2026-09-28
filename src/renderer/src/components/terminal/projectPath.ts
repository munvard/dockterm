/** Default platform for the case-fold below: the real one when running in the
 * renderer (App.tsx stamps it onto <html data-platform>), '' in unit tests
 * (node env, no DOM) — which keeps every existing case-sensitive test passing
 * unless it opts into a platform explicitly. */
function currentPlatform(): string {
  return typeof document !== 'undefined' ? (document.documentElement.dataset.platform ?? '') : ''
}

/** win32 and darwin both default to case-insensitive filesystems (NTFS,
 * APFS) — a path a shell echoes back can differ in case from the project root
 * we opened, and it should still resolve. Linux stays case-sensitive. */
function foldCase(p: string, platform: string): string {
  return platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p
}

/**
 * Resolve a path token from terminal output to a project-relative path, or null
 * when it lies outside the open project (which can't be jailed-read). Pure +
 * unit-testable. Mirrors the resolution used to open clicked paths in the editor.
 */
export function toRelProjectPath(
  raw: string,
  root: string | null,
  platform: string = currentPlatform()
): string | null {
  let p = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (root) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    const pFolded = foldCase(p, platform)
    const rFolded = foldCase(r, platform)
    if (pFolded === rFolded) return null
    if (pFolded.startsWith(rFolded + '/')) p = p.slice(r.length + 1)
  }
  // Absolute paths (POSIX or Windows) can't be opened through the project jail.
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) return null
  return p
}
