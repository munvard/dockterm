import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Claude Code's own config directory. Defaults to `~/.claude`, but Claude Code
 * itself honours `CLAUDE_CONFIG_DIR` to relocate its whole state there —
 * `projects/`, `.credentials.json`, `.claude.json`, `shell-snapshots/`,
 * `statsig/`, `todos/`. DockTerm only ever reads from here, never writes, so a
 * user who set the override would otherwise silently see empty usage/activity/
 * checkpoints panels (looking in the default `~/.claude` while Claude Code
 * itself writes elsewhere).
 */
export function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim()
  return override ? override : join(homedir(), '.claude')
}

/**
 * The `.claude.json` account/config file. With no override this is a SIBLING of
 * `~/.claude` (`~/.claude.json`, not inside it); with CLAUDE_CONFIG_DIR set it
 * moves inside that directory, per Claude Code's own relocation.
 */
export function claudeJsonPath(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim()
  return override ? join(override, '.claude.json') : join(homedir(), '.claude.json')
}
