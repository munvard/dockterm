/**
 * A watch or index path must be a plain project-relative path: no absolute path, no drive
 * letter, no UNC prefix, no "." or ".." segment, no NUL. Applied both where the renderer's
 * events enter main and where the index applies them, so neither side trusts the other.
 */
export function isSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.length > 4096 || relPath.includes('\0')) return false
  const p = relPath.replace(/\\/g, '/')
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  for (const seg of p.split('/')) {
    if (seg === '..' || seg === '.') return false
  }
  return true
}
