/**
 * Pure helpers for driving Claude Code's OWN voice mode from the chat composer.
 * DockTerm never records audio: it only reads what Claude draws on the pane.
 */

export type VoiceStatus = 'idle' | 'warming' | 'listening' | 'processing' | 'rec'

// The indicator lives near the bottom of the screen. Only the tail is searched so a
// conversation line that happens to say "listening…" above cannot fake a status.
const TAIL_ROWS = 14

const PROCESSING = /voice:\s*processing(…|\.\.\.)/i
const REC = /(^|\s)REC(\s|$)/
const LISTENING = /listening(…|\.\.\.)/i
const WARMING = /keep holding(…|\.\.\.)/i

/**
 * What Claude's voice mode is doing, read from the visible screen text.
 * hold mode: "keep holding…" (warm-up) -> "listening…" -> "Voice: processing…".
 * tap mode:  " REC · tap to send" while recording.
 */
export function detectVoiceStatus(visible: string): VoiceStatus {
  const tail = visible
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0)
    .slice(-TAIL_ROWS)
    .join('\n')
  if (PROCESSING.test(tail)) return 'processing'
  if (REC.test(tail)) return 'rec'
  if (LISTENING.test(tail)) return 'listening'
  if (WARMING.test(tail)) return 'warming'
  return 'idle'
}

/**
 * Claude's own voice error messages (read from the Claude Code 2.1.285 bundle), matched by
 * their opening words because a narrow pane wraps the line. `full` is the whole message when
 * it is fixed; otherwise the text from the match to the end of its row is used.
 */
const VOICE_ERRORS: { re: RegExp; full?: string }[] = [
  {
    re: /No audio detected from microphone/,
    full: 'No audio detected from microphone. Check that the correct input device is selected and that Claude Code has microphone access.'
  },
  { re: /Voice connection failed/, full: 'Voice connection failed. Check your network and try again.' },
  { re: /No speech detected\./, full: 'No speech detected.' },
  { re: /Voice module not loaded yet/, full: 'Voice module not loaded yet. Try again in a moment.' },
  {
    re: /Voice input is failing repeatedly/,
    full: 'Voice input is failing repeatedly and has been paused. Check your microphone and try again in a moment.'
  },
  { re: /Voice input is paused/ },
  { re: /Audio recording is not available/ },
  { re: /Failed to start audio capture/, full: 'Failed to start audio capture. Check that your microphone is accessible.' },
  { re: /Voice stream error:/ },
  { re: /Voice mode requires a Claude\.ai account/, full: 'Voice mode requires a Claude.ai account. Please run /login to sign in.' },
  { re: /Voice mode could not read your Claude\.ai login/, full: 'Voice mode could not read your Claude.ai login.' }
]

/** Rows above the input box's top rule where Claude's notice (wrapped or not) sits. */
const ERROR_ROWS_ABOVE_BOX = 3

/**
 * The voice error Claude shows just above its input box, or null. Only those few rows are read,
 * so a conversation line that quotes one of these messages never counts.
 */
export function detectVoiceError(visible: string): string | null {
  const rows = visible.split('\n').map((l) => l.trim())
  let top = -1
  for (let i = rows.length - 2; i >= 0; i--) {
    if (RULE.test(rows[i]) && PROMPT_ROW.test(rows[i + 1])) {
      top = i
      break
    }
  }
  const tail = (top === -1 ? rows : rows.slice(0, top))
    .filter((l) => l.length > 0)
    .slice(top === -1 ? -TAIL_ROWS : -ERROR_ROWS_ABOVE_BOX)
  for (let i = tail.length - 1; i >= 0; i--) {
    for (const e of VOICE_ERRORS) {
      const m = e.re.exec(tail[i])
      if (m) return e.full ?? tail[i].slice(m.index).slice(0, 200)
    }
  }
  return null
}

export interface InputBox {
  /** The box's text; '' for the empty box and for the dim `Try "..."` placeholder. */
  text: string
  /** Rows the box occupies between its two rules (at least 1). */
  lineCount: number
}

const RULE = /^─{3,}$/
// Claude on Windows draws a no-break space (U+00A0) after ❯, so any whitespace counts.
const PROMPT_ROW = /^❯(?:\s(.*))?$/
const MENU_ROW = /^\d+[.)]\s/
// Plain text has lost the placeholder's dim colour, so it is recognised by its shape.
const PLACEHOLDER = /^Try ["“][^"”]*["”]$/
// While listening, Claude draws a microphone level meter (▁ to █) at the end of its input.
const LEVEL_METER = /\s*[▁▂▃▄▅▆▇█]+$/

/**
 * Find the LAST input box on screen: a rule line of '─', a `❯ ` first row,
 * continuation rows indented two spaces, then a closing rule. Wrapped long lines
 * and real newlines look the same in plain text, and dictation has no newlines,
 * so continuation rows are joined with one space.
 */
export function parseInputBox(visible: string): InputBox | null {
  const rows = visible.split('\n').map((r) => r.trimEnd())
  for (let i = rows.length - 2; i >= 0; i--) {
    if (!RULE.test(rows[i].trim())) continue
    const first = PROMPT_ROW.exec(rows[i + 1])
    if (!first) continue
    if (MENU_ROW.test(first[1] ?? '')) continue // a permission menu, not the input
    let end = -1
    for (let j = i + 2; j < rows.length; j++) {
      if (RULE.test(rows[j].trim())) {
        end = j
        break
      }
    }
    if (end === -1) return null
    const parts = [first[1] ?? '']
    for (let j = i + 2; j < end; j++) parts.push(rows[j].replace(/^[ \u00a0]{1,2}/, ''))
    const lineCount = end - (i + 1)
    const joined = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join(' ')
      .replace(LEVEL_METER, '')
    if (lineCount === 1 && PLACEHOLDER.test(joined)) return { text: '', lineCount }
    return { text: joined, lineCount }
  }
  return null
}

/** How many Ctrl+U it takes to empty Claude's input of `lineCount` rows: one per row plus 2 spare. */
export function clearInputKeys(lineCount: number): string {
  return '\x15'.repeat(Math.max(1, lineCount) + 2)
}

/**
 * The string to insert for a transcript at a selection: a single space is added on a
 * side only when that side has text touching the insertion.
 */
export function voiceInsertion(value: string, selStart: number, selEnd: number, text: string): string {
  const t = text.trim()
  if (!t) return ''
  const before = value.slice(0, selStart)
  const after = value.slice(selEnd)
  const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trail = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  return lead + t + trail
}
