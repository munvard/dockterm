/**
 * Resolve a path token from terminal output to a project-relative path, or null
 * when it lies outside the open project (which can't be jailed-read). Pure +
 * unit-testable. Mirrors the resolution used to open clicked paths in the editor.
 */
export function toRelProjectPath(raw: string, root: string | null): string | null {
  let p = raw.replace(/\\/g, '/').replace(/^\.\//, '')
  if (root) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (p === r) return null
    if (p.startsWith(r + '/')) p = p.slice(r.length + 1)
  }
  // Absolute paths (POSIX or Windows) can't be opened through the project jail.
  if (p.startsWith('/') || /^[A-Za-z]:\//.test(p)) return null
  return p
}
