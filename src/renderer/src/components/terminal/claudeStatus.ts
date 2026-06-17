import type { AskInfo } from '@shared/types'

export type ClaudeState = 'idle' | 'working' | 'asking'

const SPINNERS = new Set(['·', '✢', '✳', '✶', '✻', '✽'])
// Box-drawing characters Claude uses around its permission prompt.
const BOX = /[│┃┆┇┊┋╎╏─━┄┅┈┉╌╍╭╮╰╯┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬]/g

/** A line like "✻ Thinking… (…)" — spinner char, space, contains an ellipsis. */
function hasTokenCounterLine(text: string): boolean {
  return text.split('\n').some((line) => {
    const first = line[0]
    return !!first && SPINNERS.has(first) && line[1] === ' ' && line.includes('…')
  })
}

/** A permission-menu line: "❯ <digit>" (after any box border / leading space). */
function hasUserPrompt(text: string): boolean {
  return text.split('\n').some((line) => {
    const t = line.replace(/^[\s│┃|>]*/, '')
    return t.startsWith('❯ ') && /\d/.test(t[2] ?? '')
  })
}

export function classify(text: string): ClaudeState {
  if (hasTokenCounterLine(text) || text.includes('esc to interrupt')) return 'working'
  if (text.includes('Esc to cancel') || hasUserPrompt(text)) return 'asking'
  return 'idle'
}

function cleanLine(line: string): string {
  return line.replace(BOX, ' ').replace(/\s+/g, ' ').trim()
}

// A cursor marker can be ❯, ›, or > in the various prompt styles.
const OPTION_RE = /^\s*[❯›>]?\s*(\d+)[.)]\s+(.*)$/
// An un-numbered, selectable action row inside the menu (e.g. multi-select's
// "Submit"). Matched only in multi-select mode so it can't catch stray prose.
const ACTION_RE = /^\s*[❯›>]?\s*(submit)\s*$/i
// A leading checkbox marker: "[ ]" unchecked, "[x]"/"[✓]"/"[✔]"/"[·]" checked.
const CHECKBOX_RE = /^\[([ xX✓✔·•])\]\s*(.*)$/
// Step / wizard tab markers (the breadcrumb across the top of multi-step prompts).
const STEP_MARK = /[☐▢🔲⬜☑✅✔✓]/g
const STEP_DONE = /[☑✅✔✓]/

/** The footer hint line ("Enter to select · ↑/↓ to navigate · Esc to cancel"). */
function isFooterLine(clean: string): boolean {
  return /esc to cancel|to navigate|enter to (select|confirm|submit)/i.test(clean)
}

/** A wizard breadcrumb line carries ≥2 step markers (☐ Step ✔ Step …). */
function isStepLine(line: string): boolean {
  return (line.match(STEP_MARK)?.length ?? 0) >= 2
}

/** Parse the wizard breadcrumb into ordered steps, if present. */
function parseSteps(raw: string[]): { label: string; done: boolean }[] {
  for (const line of raw) {
    if (!isStepLine(line)) continue
    const steps: { label: string; done: boolean }[] = []
    const re = /([☐▢🔲⬜☑✅✔✓])\s*([^☐▢🔲⬜☑✅✔✓→]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      const label = cleanLine(m[2])
      if (label) steps.push({ label, done: STEP_DONE.test(m[1]) })
    }
    if (steps.length >= 2) return steps
  }
  return []
}

/**
 * Parse a Claude prompt into a clean title, step breadcrumb, and the menu rows
 * (with per-option descriptions), in textual order so arrow-key navigation
 * counts line up. Classifies as Yes/No (one-click), checkbox multi-select, or a
 * plain single-select.
 */
export function parseAsk(text: string): AskInfo | null {
  if (classify(text) !== 'asking') return null

  const raw = text.split('\n')

  // A real checkbox prompt has "[ ]"/"[x]" rows. We deliberately DON'T trust the
  // phrase "(multi-select)" — Claude's review/confirm screen echoes it while
  // being a plain Submit/Cancel single-select.
  const multiSelect = /\[[ xX✓✔·•]\]/.test(text)
  const steps = parseSteps(raw)

  // Collect navigable rows (with any description lines beneath them) in order.
  // Numbered options always count; the un-numbered "Submit" row counts only for
  // multi-select, where it's a real navigation stop.
  const rows: { label: string; desc: string | null }[] = []
  let firstMenuIdx = -1
  let cursorRow = 0
  const hasCursorMark = (s: string): boolean => /^\s*[❯›>]/.test(s)
  for (let i = 0; i < raw.length; i++) {
    const stripped = raw[i].replace(BOX, ' ')
    const m = stripped.match(OPTION_RE)
    if (m) {
      const label = cleanLine(m[2])
      if (label) {
        if (firstMenuIdx < 0) firstMenuIdx = i
        if (hasCursorMark(stripped)) cursorRow = rows.length
        // Capture up to two indented description lines beneath the option.
        const desc: string[] = []
        for (let j = i + 1; j < raw.length && desc.length < 2; j++) {
          const s = raw[j].replace(BOX, ' ')
          if (OPTION_RE.test(s) || ACTION_RE.test(cleanLine(s))) break
          const c = cleanLine(s)
          if (!c || isFooterLine(c) || isStepLine(raw[j])) break
          desc.push(c)
        }
        rows.push({ label, desc: desc.join(' ') || null })
      }
      continue
    }
    if (multiSelect) {
      const a = cleanLine(stripped).match(ACTION_RE)
      if (a) {
        if (firstMenuIdx < 0) firstMenuIdx = i
        if (hasCursorMark(stripped)) cursorRow = rows.length
        rows.push({ label: 'Submit', desc: null })
      }
    }
  }

  // Split each row's checkbox marker (if any) from its display label.
  const options: string[] = []
  const descriptions: (string | null)[] = []
  const checkable: boolean[] = []
  const checked: boolean[] = []
  let submitIndex: number | null = null
  rows.forEach((r, i) => {
    descriptions.push(r.desc)
    const cb = r.label.match(CHECKBOX_RE)
    if (cb) {
      options.push(cleanLine(cb[2]))
      checkable.push(true)
      checked.push(cb[1] !== ' ')
    } else {
      options.push(r.label)
      checkable.push(false)
      checked.push(false)
      if (/^submit$/i.test(r.label)) submitIndex = i
    }
  })

  let title: string | null = null
  if (firstMenuIdx > 0) {
    const above = raw
      .slice(0, firstMenuIdx)
      .filter((l) => !isStepLine(l)) // the breadcrumb is shown separately
      .map(cleanLine)
      .filter(Boolean)
      .filter((l) => !isFooterLine(l))
      .filter((l) => !/^do you want to proceed\??$/i.test(l))
      .filter((l) => l.replace(/[.\s·]/g, '').length > 0) // drop dash/dot-only lines
    if (above.length) title = above.slice(-3).join(' · ').slice(0, 200)
  }

  // Binary only when there's a real numbered Yes + No — otherwise we never
  // auto-offer buttons (could be a multi-choice menu or a free-text input).
  const hasYes = options.some((o) => /^yes\b/i.test(o))
  const hasNo = options.some((o) => /^no\b/i.test(o))
  const binary = !multiSelect && options.length > 0 && hasYes && hasNo

  return {
    title,
    options,
    descriptions,
    steps,
    binary,
    multiSelect,
    checkable,
    checked,
    submitIndex,
    cursorRow
  }
}
