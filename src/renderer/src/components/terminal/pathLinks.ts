// Detect file-path-like tokens in terminal output so they can be made clickable
// (open in the editor). Conservative: requires a known code/text extension so we
// don't light up version numbers or domains.

// Longest first so e.g. `json` wins over `js`.
const EXT = [
  'tsx', 'ts', 'jsx', 'js', 'mjs', 'cjs', 'jsonc', 'json', 'markdown', 'md',
  'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'astro',
  'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cpp', 'cc', 'c', 'hpp', 'h',
  'cs', 'swift', 'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'ini',
  'env', 'sql', 'svg', 'txt', 'lock', 'cfg', 'conf', 'xml'
]
  .sort((a, b) => b.length - a.length)
  .join('|')

// Don't start a token right after a word/path char or a ':' (so URL internals
// like https://host/x.js are skipped); the extension must end at a non-letter.
const RE = new RegExp(
  `(?<![\\w/.@:-])((?:\\.{1,2}/)?[\\w.@\\-/]+\\.(?:${EXT}))(?![A-Za-z])(?::(\\d+))?(?::(\\d+))?`,
  'g'
)

export interface PathLink {
  /** 0-based index of the token start within the line */
  index: number
  /** length of the matched token (path + optional :line:col) */
  length: number
  /** the path portion (without :line:col) */
  path: string
  /** 1-based line number if present, else null */
  line: number | null
}

export function findPathLinks(text: string): PathLink[] {
  const out: PathLink[] = []
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(text)) !== null) {
    // Skip tokens that are part of a URL (WebLinks handles those).
    if (/:\/\/\S*$/.test(text.slice(0, m.index))) continue
    out.push({
      index: m.index,
      length: m[0].length,
      path: m[1],
      line: m[2] ? parseInt(m[2], 10) : null
    })
  }
  return out
}
