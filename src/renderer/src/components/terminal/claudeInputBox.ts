const RULE = /^\s*[╭╰]?[─━]{8,}[╮╯]?\s*$/
const PLACEHOLDER = /^Try ".*"$/

/**
 * What is typed in Claude Code's input box, read from the pane's visible text.
 * The box is the run of lines between two horizontal rules whose first line
 * starts with `❯` or `>` (older versions frame it as `│ > text │`). A long draft
 * wraps onto indented continuation lines, which are joined with newlines.
 * Returns the LAST such box on screen ('' when empty, or when it only shows
 * Claude's dim `Try "…"` hint, which is not text). Returns null when no box is
 * on screen at all (Claude is drawing a dialog, or it is not Claude).
 */
export function parseClaudeInputBox(screen: string): string | null {
  const lines = screen.split('\n')
  let found: string | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!RULE.test(lines[i])) continue
    let end = -1
    for (let j = i + 1; j < lines.length; j++) {
      if (RULE.test(lines[j])) {
        end = j
        break
      }
    }
    if (end < 0) break
    const body = lines.slice(i + 1, end)
    if (body.length > 0) {
      const first = stripBorder(body[0])
      if (first.startsWith('❯') || first.startsWith('>')) {
        found = boxText(body)
      }
    }
    // The closing rule may open the next box only when nothing sits between.
    i = end - 1
  }
  return found
}

function stripBorder(line: string): string {
  return line.replace(/^\s*[│┃]?\s*/, '').replace(/\s*[│┃]\s*$/, '')
}

function boxText(body: string[]): string {
  const parts = body.map((raw, idx) => {
    let s = raw.replace(/\s*[│┃]\s*$/, '').replace(/^\s*[│┃]/, '')
    if (idx === 0) s = s.replace(/^\s*(?:❯|>)\s?/, '')
    else s = s.replace(/^[ \u00a0]{1,2}/, '')
    return s.trimEnd()
  })
  while (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop()
  const text = parts.join('\n').trim()
  return PLACEHOLDER.test(text) ? '' : text
}
