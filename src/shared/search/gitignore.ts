/**
 * Minimal .gitignore semantics for the file index: comments, negation (`!`),
 * directory-only rules (`foo/`), anchoring (a "/" at the start or middle),
 * `*`, `?`, `[set]` and `**`. Rules from nested .gitignore files stack from the
 * project root down; the last matching rule wins, and a deeper file overrides a
 * shallower one. Not covered: global excludes and `.git/info/exclude`.
 */

export interface IgnoreRule {
  re: RegExp
  negate: boolean
  dirOnly: boolean
}

function escapeRe(c: string): string {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
}

function patternToSource(p: string): string {
  let out = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++
        if (p[i + 1] === '/') {
          i++
          out += '(?:.*/)?'
        } else out += '.*'
      } else out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '[') {
      const end = p.indexOf(']', i + 2)
      if (end < 0) out += '\\['
      else {
        let body = p.slice(i + 1, end)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        out += `[${body.replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (c === '\\' && i + 1 < p.length) {
      out += escapeRe(p[++i])
    } else out += escapeRe(c)
  }
  return out
}

export function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.replace(/(?<!\\)\s+$/, '')
    if (!line || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    }
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    if (!line) continue
    const anchored = line.includes('/')
    line = line.replace(/^\//, '')
    const src = patternToSource(line)
    try {
      // Unanchored rules may match at any depth; anchored ones from the .gitignore's folder.
      const re = new RegExp(anchored ? `^${src}$` : `^(?:.*/)?${src}$`)
      rules.push({ re, negate, dirOnly })
    } catch {
      // skip an unparsable line, like git does
    }
  }
  return rules
}

/** One .gitignore file: its rules plus the folder it lives in (project-relative, '' = root). */
export interface IgnoreScope {
  base: string
  rules: IgnoreRule[]
}

/** true = ignored, false = explicitly re-included, null = no rule matched. */
export function matchScope(scope: IgnoreScope, relPath: string, isDir: boolean): boolean | null {
  let sub: string
  if (scope.base === '') sub = relPath
  else if (relPath.startsWith(`${scope.base}/`)) sub = relPath.slice(scope.base.length + 1)
  else return null
  let result: boolean | null = null
  for (const r of scope.rules) {
    if (r.dirOnly && !isDir) continue
    if (r.re.test(sub)) result = !r.negate
  }
  return result
}

/** Apply every scope from the root down; the deepest decisive scope wins. */
export function isIgnoredBy(scopes: readonly IgnoreScope[], relPath: string, isDir: boolean): boolean {
  let result = false
  for (const s of scopes) {
    const m = matchScope(s, relPath, isDir)
    if (m !== null) result = m
  }
  return result
}
