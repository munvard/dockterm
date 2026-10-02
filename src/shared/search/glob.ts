/**
 * Small glob matcher for the include/exclude boxes of find-in-files.
 *
 * Syntax: `*` (not across "/"), `**` (across "/"), `?`, `[abc]`, `{a,b}`; a
 * comma separates several globs. A glob without "/" matches a file or folder NAME
 * at any depth (`*.ts`, `node_modules`); a glob with "/" is anchored at the project
 * root and also matches everything below a matched folder (`src/**`, `src/main`).
 */

function escapeRe(c: string): string {
  return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c
}

export function globToRegExpSource(glob: string): string {
  let out = ''
  let inBrace = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          out += '(?:.*/)?'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 1)
      if (end < 0) {
        out += '\\['
      } else {
        let body = glob.slice(i + 1, end)
        if (body.startsWith('!')) body = `^${body.slice(1)}`
        out += `[${body.replace(/\\/g, '\\\\')}]`
        i = end
      }
    } else if (c === '{') {
      inBrace++
      out += '(?:'
    } else if (c === '}' && inBrace > 0) {
      inBrace--
      out += ')'
    } else if (c === ',' && inBrace > 0) {
      out += '|'
    } else {
      out += escapeRe(c)
    }
  }
  while (inBrace-- > 0) out += ')'
  return out
}

/** Split on commas that are not inside {braces}. */
export function splitGlobList(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const c of text) {
    if (c === '{') depth++
    if (c === '}') depth = Math.max(0, depth - 1)
    if (c === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  parts.push(cur)
  return parts.map((p) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '')).filter(Boolean)
}

export interface GlobMatcher {
  /** `relPath` uses forward slashes, relative to the project root. */
  test(relPath: string): boolean
}

export function compileGlobs(text: string): GlobMatcher | null {
  const globs = splitGlobList(text)
  if (globs.length === 0) return null
  const rules: Array<{ anchored: boolean; re: RegExp }> = []
  for (const raw of globs) {
    const glob = raw.replace(/\/+$/, '')
    if (!glob) continue
    const anchored = glob.includes('/')
    const body = globToRegExpSource(glob.replace(/^\//, ''))
    try {
      // Anchored: the path, or any folder-prefix of it, equals the glob. Name globs: any one segment.
      rules.push({ anchored, re: new RegExp(`^${body}$`) })
    } catch {
      // an invalid glob matches nothing
    }
  }
  if (rules.length === 0) return null
  return {
    test(relPath: string): boolean {
      const segs = relPath.split('/')
      for (const r of rules) {
        if (r.anchored) {
          let prefix = ''
          for (let i = 0; i < segs.length; i++) {
            prefix = i === 0 ? segs[0] : `${prefix}/${segs[i]}`
            if (r.re.test(prefix)) return true
          }
        } else {
          for (const s of segs) if (r.re.test(s)) return true
        }
      }
      return false
    }
  }
}
