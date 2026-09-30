const MODEL = /\b((?:Opus|Sonnet|Haiku|Fable)\s+\d+(?:\.\d+)*)/
const EFFORT = /\b(?:with\s+)?(low|medium|high|xhigh|max)\s+effort\b/i

/**
 * Claude's model line from its startup screen ("Opus 5.5 with high effort ·
 * Claude Max" becomes "Opus 5.5 · high effort"), or null when it cannot be read.
 */
export function parseModelLine(screen: string): string | null {
  for (const line of screen.split('\n')) {
    const m = MODEL.exec(line)
    if (!m) continue
    const e = EFFORT.exec(line)
    return e ? `${m[1]} · ${e[1].toLowerCase()} effort` : m[1]
  }
  return null
}

/** Last folder name of a path, either slash style. */
export function projectName(cwd: string | null): string {
  if (!cwd) return ''
  const parts = cwd.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}
