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
// The main class allows both separators (`/` and `\`) so Windows output
// ("C:\Users\x\bar.ts", "src\index.ts") is matched, not just POSIX paths: a
// leading single-letter drive (`C:`) is only recognized right before that
// separator, so it can't swallow a URL scheme like "https:".
const RE = new RegExp(
  `(?<![\\w/\\\\.@:-])((?:[A-Za-z]:[\\\\/])?(?:\\.{1,2}[\\\\/])?[\\w.@\\\\\\-/]+\\.(?:${EXT}))(?![A-Za-z])(?::(\\d+))?(?::(\\d+))?`,
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

export interface CellSpan {
  /** The character(s) drawn in this cell (xterm's IBufferCell.getChars()). */
  chars: string
  /** Terminal columns this cell occupies (IBufferCell.getWidth(): 1 normally,
   * 2 for a wide character like CJK/emoji). */
  width: number
}

/**
 * Maps a JS string index into a rendered line's text (as returned by xterm's
 * `IBufferLine.translateToString`) to the terminal column it came from.
 *
 * A plain string offset drifts off the visible glyph as soon as any wide
 * character (CJK, emoji: width 2) appears earlier on the line, because it
 * still contributes only ONE JS string character, which is what made path-link
 * click targets land on the wrong text. `cells` is the line's cell sequence in
 * display order (one entry per occupied column; the filler cell for the
 * second half of a wide character is simply absent from the sequence).
 */
export function columnForStringIndex(cells: CellSpan[], strIndex: number): number {
  let col = 0
  let consumed = 0
  for (const cell of cells) {
    if (consumed >= strIndex) break
    consumed += cell.chars.length || 1
    col += cell.width || 1
  }
  return col
}
