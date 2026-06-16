import { app } from 'electron'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

/**
 * Shell integration: make the spawned shell emit OSC 7 (its working directory) on
 * every prompt, so the dock can follow `cd`. We inject this the same way VS Code
 * does — without permanently editing the user's dotfiles:
 *   - zsh:  point ZDOTDIR at our dir whose startup files re-source the user's
 *   - bash: --rcfile our init file (which sources the user's profile + bashrc)
 *   - pwsh: -Command that wraps the prompt function
 * Unsupported shells (cmd, fish, …) return null → spawn unchanged (dock falls
 * back to the pane's spawn folder).
 */
export type ShellKind = 'zsh' | 'bash' | 'pwsh' | 'other'

export function shellKind(file: string): ShellKind {
  const b = basename(file).toLowerCase().replace(/\.exe$/, '')
  if (b === 'zsh') return 'zsh'
  if (b === 'bash') return 'bash'
  if (b === 'pwsh' || b === 'powershell') return 'pwsh'
  return 'other'
}

export interface Integration {
  args: string[]
  env: Record<string, string>
}

/**
 * Pure: decide the spawn args + env overrides for a shell, given the integration
 * directory. Returns null for shells we don't integrate. (File contents are
 * written separately by ensureIntegrationFiles.)
 */
export function buildIntegration(
  shellFile: string,
  baseArgs: string[],
  dir: string,
  env: NodeJS.ProcessEnv
): Integration | null {
  switch (shellKind(shellFile)) {
    case 'zsh':
      // zsh reads $ZDOTDIR/.zshenv,.zprofile,.zshrc,.zlogin — our copies source
      // the user's then add the OSC 7 hook. Keep the user's base args (e.g. -l).
      return {
        args: baseArgs,
        env: { ZDOTDIR: dir, DOCKTERM_USER_ZDOTDIR: env['ZDOTDIR'] ?? env['HOME'] ?? '' }
      }
    case 'bash':
      // --rcfile runs our init (which sources profile + bashrc); -i for interactive.
      return { args: ['--rcfile', join(dir, 'bash-integration.bash'), '-i'], env: {} }
    case 'pwsh':
      return {
        args: [...baseArgs, '-NoExit', '-Command', `. '${join(dir, 'pwsh-integration.ps1')}'`],
        env: {}
      }
    default:
      return null
  }
}

const ZSHENV = `# DockTerm shell integration (auto-generated)
DOCKTERM_USER_ZDOTDIR="\${DOCKTERM_USER_ZDOTDIR:-$HOME}"
[ -f "$DOCKTERM_USER_ZDOTDIR/.zshenv" ] && source "$DOCKTERM_USER_ZDOTDIR/.zshenv"
`
const ZPROFILE = `# DockTerm shell integration (auto-generated)
[ -f "$DOCKTERM_USER_ZDOTDIR/.zprofile" ] && source "$DOCKTERM_USER_ZDOTDIR/.zprofile"
`
const ZLOGIN = `# DockTerm shell integration (auto-generated)
[ -f "$DOCKTERM_USER_ZDOTDIR/.zlogin" ] && source "$DOCKTERM_USER_ZDOTDIR/.zlogin"
`
const ZSHRC = `# DockTerm shell integration (auto-generated)
[ -f "$DOCKTERM_USER_ZDOTDIR/.zshrc" ] && source "$DOCKTERM_USER_ZDOTDIR/.zshrc"
_dockterm_osc7() { printf '\\033]7;file://%s%s\\a' "\${HOST}" "\${PWD}"; }
typeset -ag precmd_functions
precmd_functions+=(_dockterm_osc7)
# Restore ZDOTDIR so the interactive session sees the user's own value.
[ -n "$DOCKTERM_USER_ZDOTDIR" ] && export ZDOTDIR="$DOCKTERM_USER_ZDOTDIR"
`
const BASH_INIT = `# DockTerm shell integration (auto-generated)
# We run bash with --rcfile (interactive, non-login), which skips the normal
# login startup. Re-source it so the system prompt (e.g. macOS /etc/bashrc) and
# PATH are preserved, then add the OSC 7 directory hook.
[ -r /etc/profile ] && . /etc/profile
if [ -f ~/.bash_profile ]; then . ~/.bash_profile;
elif [ -f ~/.bash_login ]; then . ~/.bash_login;
elif [ -f ~/.profile ]; then . ~/.profile; fi
[ -f ~/.bashrc ] && . ~/.bashrc
_dockterm_osc7() { printf '\\033]7;file://%s%s\\a' "\${HOSTNAME}" "\${PWD}"; }
case "$PROMPT_COMMAND" in
  *_dockterm_osc7*) ;;
  *) PROMPT_COMMAND="_dockterm_osc7\${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;;
esac
`
const PWSH_INIT = `# DockTerm shell integration (auto-generated)
$global:__dockterm_origPrompt = $function:prompt
function global:prompt {
  $loc = (Get-Location).ProviderPath
  $esc = [char]27; $bel = [char]7
  $p = $loc -replace '\\\\','/'
  [Console]::Write("$esc]7;file://$($env:COMPUTERNAME)/$p$bel")
  if ($__dockterm_origPrompt) { & $__dockterm_origPrompt } else { "PS $loc> " }
}
`

const FILES: Record<string, string> = {
  '.zshenv': ZSHENV,
  '.zprofile': ZPROFILE,
  '.zlogin': ZLOGIN,
  '.zshrc': ZSHRC,
  'bash-integration.bash': BASH_INIT,
  'pwsh-integration.ps1': PWSH_INIT
}

/** Write the integration scripts (idempotent) and return the integration dir. */
export function ensureIntegrationFiles(): string {
  const dir = join(app.getPath('userData'), 'shell-integration')
  mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(FILES)) {
    const p = join(dir, name)
    // Rewrite only when missing or stale, so we don't thrash the disk every spawn.
    if (!existsSync(p) || safeRead(p) !== content) writeFileSync(p, content, 'utf8')
  }
  return dir
}

function safeRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

/** Convenience used by ptyService: ensure files then build the integration. */
export function integrationFor(
  shellFile: string,
  baseArgs: string[],
  env: NodeJS.ProcessEnv
): Integration | null {
  const probe = buildIntegration(shellFile, baseArgs, '', env)
  if (!probe) return null // unsupported shell — skip the file write entirely
  return buildIntegration(shellFile, baseArgs, ensureIntegrationFiles(), env)
}
