import { classify } from './claudeStatus'

const RULE = /^\s*[╭╰]?[─━]{8,}[╮╯]?\s*$/

/**
 * Claude Code's idle input box: a horizontal rule, the `❯ ` (or `> `) prompt
 * line, another rule (older versions draw a `╭──╮ │ > │ ╰──╯` box). Neither
 * classify() state matches it, because an idle Claude prints no spinner and no
 * menu. A shell prompt, even a `❯` one, is never fenced by two rules.
 */
export function hasClaudeInputBox(text: string): boolean {
  const lines = text.split('\n')
  for (let i = 1; i < lines.length - 1; i++) {
    if (!RULE.test(lines[i - 1]) || !RULE.test(lines[i + 1])) continue
    const body = lines[i].replace(/^\s*[│┃]?\s*/, '')
    if (body.startsWith('❯') || body.startsWith('>')) return true
  }
  return false
}

/** Claude is on screen in any state: working, asking, or idle at its prompt. */
export function claudeOnScreen(text: string): boolean {
  return classify(text) !== 'idle' || hasClaudeInputBox(text)
}

/** A last screen line that looks like a shell waiting for input ('41%' is progress, not a zsh prompt). */
const PROMPT_END = /[$#>❯»➜λ]\s*$|(?<!\d)%\s*$/

/**
 * Windows can't report a pty's foreground process (`pty:foreground` is ''), so
 * decide from the screen whether closing the pane would kill something live.
 * Returns a label for the confirm dialog, or null when the pane is empty or
 * sitting at a plain prompt (closing loses nothing).
 */
export function unknownProcessLabel(text: string, alternateBuffer: boolean): string | null {
  if (alternateBuffer) return 'A full-screen program'
  if (claudeOnScreen(text)) return 'claude'
  const last = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
    .pop()
  if (!last) return null
  return PROMPT_END.test(last) ? null : 'A program'
}
