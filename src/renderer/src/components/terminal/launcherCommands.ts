/** The Claude launcher actions and the exact command each writes into the PTY.
 * Kept pure (no React) so the mapping is unit-testable. The trailing \r submits. */
export type LaunchAction = 'new' | 'resume' | 'continue'

export function launchCommand(action: LaunchAction): string {
  switch (action) {
    case 'new':
      return 'claude\r'
    case 'resume':
      return 'claude --resume\r'
    case 'continue':
      return 'claude --continue\r'
  }
}
