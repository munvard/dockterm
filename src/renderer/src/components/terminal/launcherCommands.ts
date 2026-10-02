/** The Claude launcher actions and the exact command each writes into the PTY.
 * Kept pure (no React) so the mapping is unit-testable. The trailing \r submits. */
export type LaunchAction = 'new' | 'resume' | 'continue'

/** `claudeFlag` is `--settings "<DockTerm file>"` for a shell that has no DockTerm
 * `claude` hook (cmd, fish, shell integration off); it lets Claude's real usage be
 * captured. Hooked shells and capture-off panes pass nothing and type plain `claude`. */
export function launchCommand(action: LaunchAction, claudeFlag?: string | null): string {
  const base = claudeFlag ? `claude ${claudeFlag}` : 'claude'
  switch (action) {
    case 'new':
      return `${base}\r`
    case 'resume':
      return `${base} --resume\r`
    case 'continue':
      return `${base} --continue\r`
  }
}
