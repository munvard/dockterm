import { classify } from './claudeStatus'

const RULE = /^\s*[╭╰]?[─━]{8,}[╮╯]?\s*$/

/** Tallest input box we look for: Claude grows the box as a draft wraps. */
const MAX_BOX_ROWS = 40

/**
 * Claude Code's input box: a horizontal rule, the `❯ ` (or `> `) prompt line,
 * the draft's wrapped rows, another rule (older versions draw a `╭──╮ │ > │ ╰──╯`
 * box). Neither classify() state matches it, because an idle Claude prints no
 * spinner and no menu. A shell prompt, even a `❯` one, is never fenced by two rules.
 */
export function hasClaudeInputBox(text: string): boolean {
  const lines = text.split('\n')
  for (let i = 1; i < lines.length - 1; i++) {
    if (!RULE.test(lines[i - 1])) continue
    const body = lines[i].replace(/^\s*[│┃]?\s*/, '')
    if (!body.startsWith('❯') && !body.startsWith('>')) continue
    for (let j = i + 1; j < lines.length && j <= i + MAX_BOX_ROWS; j++) {
      if (RULE.test(lines[j])) return true
    }
  }
  return false
}

/** Claude is on screen in any state: working, asking, or idle at its prompt. */
export function claudeOnScreen(text: string): boolean {
  return classify(text) !== 'idle' || hasClaudeInputBox(text)
}

/**
 * Is CLAUDE (not just "some program") the foreground program of a pane? The
 * composer and the voice machine type into the pane, so this fails closed:
 * `process` is the pty's foreground process name (null = unknown or session
 * gone, '' = the platform cannot tell, as on Windows). A shell, an unknown
 * process, or a screen that does not look like Claude all answer false, so
 * a prompt is never pasted into python, vim, ssh, sudo or a bare shell.
 */
export function claudeIsForeground(
  process: string | null,
  screen: string,
  isShell: (name: string) => boolean
): boolean {
  if (process === null) return false
  if (process !== '' && isShell(process)) return false
  return claudeOnScreen(screen)
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
