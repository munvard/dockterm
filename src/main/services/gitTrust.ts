import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { git } from './gitCore'

export interface ExecConfigEntry {
  key: string
  value: string
}

const VALUE_MAX = 200
const EXEC_TRANSPORT = /^(ext|fd)::/i
const FALSE_WORDS = new Set(['false', 'no', 'off', '0'])

/** Zero-width, bidi-control and line-separator characters that can make text on
 * screen read differently from what it is. */
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** Text from a repo, made safe to show in the "Run anyway" dialog: control
 * characters (including ESC, so ANSI sequences show as text) and invisible or
 * direction-changing characters are written out as escapes, newlines as \n.
 * Escaping happens BEFORE truncation so nothing can hide behind the cut. */
export function displaySafe(v: string): string {
  let out = ''
  for (const ch of v) {
    if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (CONTROL.test(ch)) out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    else if (INVISIBLE.test(ch)) out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out.length > VALUE_MAX ? out.slice(0, VALUE_MAX) + '…' : out
}

/** Split a git config key into its section, optional subsection and variable.
 * The subsection may itself contain dots (a URL), so only the FIRST and LAST dot
 * are structural. Section and variable are case-insensitive in git and are
 * lowercased here; the subsection is kept as written. */
function splitKey(key: string): { section: string; sub: string | null; name: string } {
  const first = key.indexOf('.')
  const last = key.lastIndexOf('.')
  if (first < 0) return { section: key.toLowerCase(), sub: null, name: '' }
  if (first === last) {
    return { section: key.slice(0, first).toLowerCase(), sub: null, name: key.slice(first + 1).toLowerCase() }
  }
  return {
    section: key.slice(0, first).toLowerCase(),
    sub: key.slice(first + 1, last),
    name: key.slice(last + 1).toLowerCase()
  }
}

const CORE_SAFE = new Set([
  'repositoryformatversion',
  'filemode',
  'bare',
  'logallrefupdates',
  'ignorecase',
  'precomposeunicode',
  'autocrlf',
  'safecrlf',
  'symlinks',
  'eol',
  'quotepath',
  'abbrev',
  'sparsecheckout',
  'sparsecheckoutcone'
])
const BRANCH_SAFE = new Set(['remote', 'merge', 'rebase', 'pushremote', 'description'])
// promisor / partialclonefilter are plain data on a partial clone, not commands.
const REMOTE_SAFE = new Set([
  'url',
  'pushurl',
  'fetch',
  'push',
  'tagopt',
  'prune',
  'mirror',
  'promisor',
  'partialclonefilter'
])
const SUBMODULE_SAFE = new Set(['url', 'path', 'active', 'branch'])

/** A URL-ish setting that names git's `ext::` / `fd::` transports, which run an
 * arbitrary command (or hand git a file descriptor) instead of connecting. */
function usesExecTransport(key: string, value: string): boolean {
  const { section, sub, name } = splitKey(key)
  const v = value.trim()
  if (section === 'remote' || section === 'submodule') {
    return (name === 'url' || name === 'pushurl') && EXEC_TRANSPORT.test(v)
  }
  if (section === 'url') {
    // `[url "<base>"] insteadOf = <prefix>` rewrites <prefix> into <base>, so a
    // hostile transport normally sits in the subsection. Either side is flagged.
    return (
      (name === 'insteadof' || name === 'pushinsteadof') &&
      ((sub !== null && EXEC_TRANSPORT.test(sub)) || EXEC_TRANSPORT.test(v))
    )
  }
  return false
}

/**
 * ALLOWLIST. True only for repo-controlled settings that are known to be plain
 * data. Everything else counts as "runs or may run a command": filter, diff and
 * merge drivers, the alias, pager, credential, gpg, protocol, trailer, uploadpack
 * and receivepack sections, core.sshCommand / askPass / gitProxy / editor / pager
 * / hooksPath / fsmonitor / alternateRefsCommand, diff.external,
 * interactive.diffFilter, remote.NAME.vcs, and any key a future git adds. The
 * include and includeIf sections fall through too: an include can pull in any of
 * the above.
 */
function isKnownSafe(key: string, value: string): boolean {
  if (usesExecTransport(key, value)) return false
  const { section, sub, name } = splitKey(key)
  const v = value.trim()
  switch (section) {
    case 'core':
      return sub === null && CORE_SAFE.has(name)
    case 'user':
    case 'extensions':
    case 'gc':
    case 'pack':
    case 'index':
    case 'feature':
    case 'color':
      return true
    case 'branch':
      return sub !== null && BRANCH_SAFE.has(name)
    case 'remote':
      return sub !== null && REMOTE_SAFE.has(name)
    case 'pull':
      return sub === null && (name === 'rebase' || name === 'ff')
    case 'push':
      return sub === null && (name === 'default' || name === 'autosetupremote' || name === 'followtags')
    case 'fetch':
      return sub === null && name === 'prune'
    case 'rebase':
      return sub === null && (name === 'autostash' || name === 'autosquash')
    case 'merge':
      return sub === null && (name === 'ff' || name === 'conflictstyle')
    case 'diff':
      return sub === null && (name === 'renames' || name === 'algorithm' || name === 'colormoved')
    case 'commit':
      return sub === null && name === 'gpgsign' && FALSE_WORDS.has(v.toLowerCase())
    case 'lfs':
      // Custom transfer agents are commands.
      return !(sub?.toLowerCase().startsWith('customtransfer') || name === 'standalonetransferagent')
    case 'submodule':
      if (name === 'update') return sub !== null && !v.startsWith('!')
      return (sub !== null || name === 'active') && SUBMODULE_SAFE.has(name)
    case 'url':
      return sub !== null && (name === 'insteadof' || name === 'pushinsteadof')
    default:
      return false
  }
}

/** Scopes that belong to the user: system, global, the command line (ours), and
 * "unknown", which is what git labels config it cannot attribute (Apple's bundled
 * system gitconfig prints it; local, worktree and submodule are always named).
 * Any other scope, including one a future git adds, is treated as
 * repo-controlled. */
const USER_SCOPES = new Set(['system', 'global', 'command', 'unknown'])

/**
 * Given the output of `git config --list --show-scope --includes --null`,
 * return the repo-controlled settings (any scope but system, global, command and unknown;
 * includes followed) that are NOT known-safe: the ones that make git run, or
 * possibly run, a command. `--local` alone would be wrong: it turns include.*
 * processing off, while git itself follows includes when it stages or commits,
 * so an `include.path` could hide a filter driver from the scan.
 *
 * `--null --show-scope` prints `scope NUL key NEWLINE value NUL` per entry (a
 * bare boolean key has no newline). Output that does not have that shape is an
 * error, never "nothing found": the caller must treat the config as unknown.
 * Keys and values are raw here; use {@link detectExecConfig} for display.
 */
export function scanExecConfig(output: string): ExecConfigEntry[] {
  const found: ExecConfigEntry[] = []
  const parts = output.split('\0')
  if (parts[parts.length - 1] !== '') throw new Error('Unreadable git config output')
  parts.pop()
  if (parts.length % 2 !== 0) throw new Error('Unreadable git config output')
  for (let i = 0; i < parts.length; i += 2) {
    const scope = parts[i].trim().toLowerCase()
    if (!scope) throw new Error('Unreadable git config output')
    if (USER_SCOPES.has(scope)) continue
    const raw = parts[i + 1]
    const nl = raw.indexOf('\n')
    const key = nl < 0 ? raw : raw.slice(0, nl)
    const value = nl < 0 ? '' : raw.slice(nl + 1)
    if (!key) throw new Error('Unreadable git config output')
    if (!isKnownSafe(key, value)) found.push({ key, value })
  }
  return found
}

/** {@link scanExecConfig} with keys and values made safe to show to the user. */
export function detectExecConfig(output: string): ExecConfigEntry[] {
  return scanExecConfig(output).map((e) => ({ key: displaySafe(e.key), value: displaySafe(e.value) }))
}

/** Repos the user explicitly chose to "Run anyway" for, this app session only. */
const trustedRoots = new Set<string>()

export function canonicalRoot(root: string): string {
  try {
    return realpathSync(root)
  } catch {
    return resolve(root)
  }
}

export function trustRepo(root: string): void {
  trustedRoots.add(canonicalRoot(root))
}

export function isRepoTrusted(root: string): boolean {
  return trustedRoots.has(canonicalRoot(root))
}

export function clearTrustedRepos(): void {
  trustedRoots.clear()
}

export type LocalConfigReader = (root: string) => Promise<string>

/** Read-only, through the hardened git() wrapper (hooks off, fsmonitor off). All
 * scopes are listed with `--includes`, so config pulled in by include.path /
 * includeIf and worktree config are seen exactly as git will see them. */
const readLocalConfig: LocalConfigReader = (root) =>
  git(root).raw(['config', '--list', '--show-scope', '--includes', '--null'])

/**
 * The raw exec-capable repo config keys standing between the user and a git
 * operation on `root`, or [] when the repo is trusted for this session or has
 * none. Outside a repository there is no repo config: the operation itself will
 * report that. ANY other failure (git error, timeout, unreadable output)
 * rejects: the config is then unknown, which must never read as "no dangerous
 * keys".
 */
async function pendingRaw(root: string, reader: LocalConfigReader): Promise<ExecConfigEntry[]> {
  if (isRepoTrusted(root)) return []
  let output: string
  try {
    output = await reader(root)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/not a git repository|only be used inside a git repository/i.test(msg)) return []
    throw e
  }
  return scanExecConfig(output)
}

/** {@link pendingRaw} with display-safe keys and values, for the trust dialog. */
export async function pendingExecConfig(
  root: string,
  reader: LocalConfigReader = readLocalConfig
): Promise<ExecConfigEntry[]> {
  return (await pendingRaw(root, reader)).map((e) => ({ key: displaySafe(e.key), value: displaySafe(e.value) }))
}

/** Throws unless `root` is trusted or has no command-running config. The
 * network path calls this itself, so the user's own GIT_SSH_COMMAND / askpass
 * can never reach a repo that skipped the gate. */
export async function assertGateOpen(root: string, reader: LocalConfigReader = readLocalConfig): Promise<void> {
  const entries = await pendingRaw(root, reader)
  if (entries.length > 0) throw new Error(`UNTRUSTED_GIT_CONFIG: ${entries.map((e) => displaySafe(e.key)).join(', ')}`)
}

/** Distinct filter driver names among the flagged entries (`filter.<name>.<var>`). */
export function filterDriverNames(entries: ExecConfigEntry[]): string[] {
  const names = new Set<string>()
  for (const e of entries) {
    const { section, sub } = splitKey(e.key)
    if (section === 'filter' && sub !== null) names.add(sub)
  }
  return [...names]
}

/** `-c` settings that empty every repo-defined filter driver. Git treats an empty
 * clean / smudge / process command as "no filter", and `required=false` stops it
 * failing on the empty one. A name `-c key=value` cannot express (it contains an
 * `=` or a newline) cannot be neutralized, so that read fails closed. */
export function filterOverrides(names: string[]): string[] {
  const out: string[] = []
  for (const n of names) {
    if (/[=\n\r\0]/.test(n)) throw new Error('Refusing to read a repo with an unsafe filter driver name')
    out.push(`filter.${n}.clean=`, `filter.${n}.smudge=`, `filter.${n}.process=`, `filter.${n}.required=false`)
  }
  return out
}

/** Extra `-c` settings for the automatic read-only git calls: [] for a trusted
 * repo or one with no command-running config, the filter overrides otherwise.
 * If the config cannot be read this REJECTS (fail closed): running the read
 * without knowing which drivers exist would be the unsafe choice, and the same
 * broken config would fail the read itself anyway. Diff drivers (textconv /
 * command) are not overridden here: an empty value makes git try to run "" and
 * die, so those are disabled with `--no-ext-diff --no-textconv` on every diff. */
export async function readOnlyHardening(
  root: string,
  reader: LocalConfigReader = readLocalConfig
): Promise<string[]> {
  return filterOverrides(filterDriverNames(await pendingRaw(root, reader)))
}
