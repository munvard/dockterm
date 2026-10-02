/** "report.txt" -> "report copy.txt" -> "report copy 2.txt" (first name not in `taken`). */
export function duplicateName(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0 && dot < name.length - 1
  const stem = hasExt ? name.slice(0, dot) : name
  const ext = hasExt ? name.slice(dot) : ''
  let candidate = `${stem} copy${ext}`
  for (let n = 2; taken.has(candidate); n++) candidate = `${stem} copy ${n}${ext}`
  return candidate
}

/** A file or folder name the user typed: no separators, not empty, not a dot name. */
export function validEntryName(name: string): string | null {
  const t = name.trim()
  if (!t) return 'Enter a name'
  if (t === '.' || t === '..') return 'Invalid name'
  if (/[\\/]/.test(t)) return 'A name cannot contain / or \\'
  if (/[<>:"|?*\u0000-\u001f]/.test(t)) return 'A name cannot contain < > : " | ? *'
  if (t.length > 255) return 'That name is too long'
  return null
}
