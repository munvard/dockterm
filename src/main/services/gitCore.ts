import { simpleGit, type SimpleGit } from 'simple-git'

/** Environment variables simple-git 3.36 refuses to run with (it throws "Use of X
 * is not permitted without enabling allowUnsafeY" on every call). They are
 * common in a normal shell (EDITOR=vim, Homebrew's PREFIX), so the git wrapper
 * removes them instead of failing every call. Matched case-insensitively:
 * Windows environment keys are case-insensitive. */
const BLOCKED_ENV = new Set([
  'EDITOR',
  'PAGER',
  'PREFIX',
  'GIT_EDITOR',
  'GIT_PAGER',
  'GIT_SEQUENCE_EDITOR',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_PROXY_COMMAND',
  'GIT_EXTERNAL_DIFF',
  'GIT_EXEC_PATH',
  'GIT_TEMPLATE_DIR'
])
const BLOCKED_PREFIXES = ['GIT_CONFIG']

/** The user's own credential / transport helpers. Kept for a user-initiated
 * push or pull only: the user's environment is trusted, repo config is not. */
const NETWORK_KEEP = new Set(['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PROXY_COMMAND'])

export interface GitEnvOptions {
  /** A push or pull the user started: keep their GIT_SSH*, askpass and proxy vars. */
  userNetworkOp?: boolean
}

/** A copy of `base` that simple-git will accept, plus the two vars every call
 * needs: GIT_TERMINAL_PROMPT=0 (never open a blocking credential prompt) and
 * GIT_OPTIONAL_LOCKS=0 (background status must not race a real index.lock). */
export function gitEnv(
  base: Record<string, string | undefined>,
  opts: GitEnvOptions = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    const blocked = BLOCKED_ENV.has(upper) || BLOCKED_PREFIXES.some((p) => upper.startsWith(p))
    if (blocked && !(opts.userNetworkOp && NETWORK_KEEP.has(upper))) continue
    out[key] = value
  }
  // Drop any differently-cased copies so the values below are the only ones.
  for (const key of Object.keys(out)) {
    const upper = key.toUpperCase()
    if (upper === 'GIT_TERMINAL_PROMPT' || upper === 'GIT_OPTIONAL_LOCKS') delete out[key]
  }
  out.GIT_TERMINAL_PROMPT = '0'
  out.GIT_OPTIONAL_LOCKS = '0'
  return out
}

export interface GitOptions extends GitEnvOptions {
  /** Extra `-c key=value` settings, all of which neutralize (never add) behaviour. */
  extraConfig?: string[]
}

/**
 * Every git invocation — from the git service AND from projectService /
 * projectInfoService's lighter-weight lookups — goes through here.
 * `core.hooksPath=` neutralizes any hooks the (possibly untrusted) project repo
 * defines — opening a malicious repo must never run its code (CVE-2024-32002
 * class). `core.fsmonitor=false` stops a repo-local fsmonitor hook (an arbitrary
 * script honored automatically by plain `git status`) from auto-executing.
 * `GIT_TERMINAL_PROMPT=0` stops a push/pull from opening a native username/
 * password prompt that would block the main process; `GIT_OPTIONAL_LOCKS=0`
 * stops our own background status polls from racing a real `.git/index.lock`
 * (e.g. a commit the user is running by hand in the terminal at the same
 * moment). A block timeout stops a call from hanging forever if a credential
 * helper dialog is left open.
 */
export function git(root: string, opts: GitOptions = {}): SimpleGit {
  const extra = opts.extraConfig ?? []
  return simpleGit({
    baseDir: root,
    config: ['core.hooksPath=', 'core.fsmonitor=false', ...extra],
    unsafe: {
      allowUnsafeHooksPath: true,
      allowUnsafeFsMonitor: true,
      // Only ever used to EMPTY a filter driver (see gitService.readOnlyGit).
      allowUnsafeFilter: extra.length > 0,
      ...(opts.userNetworkOp
        ? { allowUnsafeSshCommand: true, allowUnsafeAskPass: true, allowUnsafeGitProxy: true }
        : {})
    },
    trimmed: true,
    timeout: { block: 120_000 }
  }).env(gitEnv(process.env, opts))
}
