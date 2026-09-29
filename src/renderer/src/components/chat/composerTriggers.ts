/** Pure helpers for the composer's `/` command menu and `@` file picker. */

export interface Trigger {
  kind: 'slash' | 'at'
  query: string
  /** Index of the `/` or `@`. */
  start: number
  /** The caret (end of the query). */
  end: number
}

/** `/word` at the start of the caret's line, or `@word` after whitespace / line start. */
export function detectTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret)
  const lineStart = before.lastIndexOf('\n') + 1
  const line = before.slice(lineStart)
  const slash = /^\/([\w:.-]*)$/.exec(line)
  if (slash) return { kind: 'slash', query: slash[1], start: lineStart, end: caret }
  const at = /(^|\s)@([^\s@]*)$/.exec(line)
  if (at) {
    const start = lineStart + line.length - at[2].length - 1
    return { kind: 'at', query: at[2], start, end: caret }
  }
  return null
}

/** Replace the trigger text with `insert`, returning the new value and caret. */
export function applyCompletion(
  value: string,
  trigger: Trigger,
  insert: string
): { value: string; caret: number } {
  const next = value.slice(0, trigger.start) + insert + value.slice(trigger.end)
  return { value: next, caret: trigger.start + insert.length }
}

export interface CommandItem {
  /** With the leading slash, e.g. `/clear`. */
  name: string
  description: string
  source: 'built-in' | 'skill' | 'command'
}

export const BUILTIN_COMMANDS: CommandItem[] = [
  ['/clear', 'Clear the conversation'],
  ['/compact', 'Summarize the conversation to free context'],
  ['/model', 'Choose the model'],
  ['/resume', 'Resume an earlier session'],
  ['/review', 'Review a pull request'],
  ['/voice', 'Turn Claude voice mode on or off'],
  ['/cost', 'Show token usage and cost'],
  ['/help', 'Show help'],
  ['/init', 'Create a CLAUDE.md for this project'],
  ['/memory', 'Edit memory files'],
  ['/agents', 'Manage sub-agents'],
  ['/mcp', 'Manage MCP servers'],
  ['/config', 'Open settings'],
  ['/status', 'Show account and session status'],
  ['/permissions', 'Manage tool permissions'],
  ['/context', 'Show what fills the context window'],
  ['/add-dir', 'Add a working directory'],
  ['/export', 'Export the conversation'],
  ['/doctor', 'Check the Claude Code install'],
  ['/login', 'Sign in'],
  ['/logout', 'Sign out']
].map(([name, description]) => ({ name, description, source: 'built-in' as const }))

/**
 * Subsequence match score: -1 when `query` is not a subsequence of `target`.
 * Higher is better: prefix and word-start hits and consecutive runs win, short
 * targets beat long ones. Empty query matches everything with score 0.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  const whole = t.indexOf(q)
  if (whole === 0) return 1000 - t.length
  if (whole > 0) return (/[\s/_.-]/.test(t[whole - 1]) ? 700 : 500) - whole - t.length / 100
  let ti = 0
  let score = 0
  let run = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    run = found === ti ? run + 1 : 0
    score += 10 + run * 5 + (found === 0 || /[\s/_.-]/.test(t[found - 1]) ? 8 : 0)
    ti = found + 1
  }
  return score - t.length / 100
}

export function rankFuzzy<T>(items: T[], query: string, text: (t: T) => string, limit = 50): T[] {
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

/** Built-ins first, then project/user skills and commands; a user item never repeats a built-in name. */
export function mergeCommands(
  extras: { slashName: string; description: string; source: 'skill' | 'command' }[]
): CommandItem[] {
  const seen = new Set(BUILTIN_COMMANDS.map((c) => c.name))
  const out = [...BUILTIN_COMMANDS]
  for (const e of extras) {
    const name = e.slashName.startsWith('/') ? e.slashName : `/${e.slashName}`
    if (seen.has(name)) continue
    seen.add(name)
    out.push({ name, description: e.description, source: e.source })
  }
  return out
}
