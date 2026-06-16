export type ClaudeState = 'idle' | 'working' | 'asking'

const SPINNERS = new Set(['·', '✢', '✳', '✶', '✻', '✽'])

/** A line like "✻ Thinking… (…)" — spinner char, space, contains an ellipsis. */
function hasTokenCounterLine(text: string): boolean {
  return text.split('\n').some((line) => {
    const first = line[0]
    return !!first && SPINNERS.has(first) && line[1] === ' ' && line.includes('…')
  })
}

/** A permission-menu line: (trim-left) "❯ " followed by a digit. */
function hasUserPrompt(text: string): boolean {
  return text.split('\n').some((line) => {
    const t = line.replace(/^ +/, '')
    return t.startsWith('❯ ') && /\d/.test(t[2] ?? '')
  })
}

export function classify(text: string): ClaudeState {
  if (hasTokenCounterLine(text) || text.includes('esc to interrupt')) return 'working'
  if (text.includes('Esc to cancel') || hasUserPrompt(text)) return 'asking'
  return 'idle'
}

/** Best-effort: the non-empty lines just above the menu (the question/command). */
export function parseAsk(text: string): string | null {
  if (classify(text) !== 'asking') return null
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const menuIdx = lines.findIndex((l) => /^\s*❯ \d/.test(l) || l.includes('Esc to cancel'))
  if (menuIdx < 0) return null
  const above = lines
    .slice(Math.max(0, menuIdx - 4), menuIdx)
    .map((l) => l.trim())
    .filter(Boolean)
  return above.length ? above.join('\n') : null
}
