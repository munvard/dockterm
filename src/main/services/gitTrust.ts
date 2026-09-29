import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { git } from './gitService'

export interface ExecConfigEntry {
  key: string
  value: string
}

const VALUE_MAX = 200
const BOOL_WORDS = new Set(['true', 'false', 'yes', 'no', 'on', 'off', '0', '1'])
const EXEC_TRANSPORT = /^(ext|fd)::/i

function truncate(v: string): string {
  return v.length > VALUE_MAX ? v.slice(0, VALUE_MAX) + '…' : v
}

/** Split a git config key into its section, optional subsection and variable.
 * The subsection may itself contain dots (a URL), so only the FIRST and LAST dot
 * are structural. Section and variable are case-insensitive in git; the
 * subsection is compared as-is but none of the rules below depend on its case
 * except the transport prefix, which is matched case-insensitively. */
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

function isExecKey(key: string, value: string): boolean {
  const { section, sub, name } = splitKey(key)
  const v = value.trim()
  switch (section) {
    case 'filter':
      return sub !== null && (name === 'clean' || name === 'smudge' || name === 'process')
    case 'diff':
      return sub !== null && (name === 'textconv' || name === 'command')
    case 'merge':
      return sub !== null && name === 'driver'
    case 'credential':
      return name === 'helper'
    case 'gpg':
      return name === 'program'
    case 'core':
      if (sub !== null) return false
      if (name === 'fsmonitor') return !BOOL_WORDS.has(v.toLowerCase()) && v !== ''
      return (
        name === 'sshcommand' || name === 'hookspath' || name === 'editor' || name === 'pager'
      )
    case 'sequence':
      return sub === null && name === 'editor'
    case 'uploadpack':
      return sub === null && name === 'packobjectshook'
    case 'remote':
      if (sub === null) return false
      if (name === 'uploadpack' || name === 'receivepack') return true
      return (name === 'url' || name === 'pushurl') && EXEC_TRANSPORT.test(v)
    case 'url':
      return (
        sub !== null &&
        (name === 'insteadof' || name === 'pushinsteadof') &&
        EXEC_TRANSPORT.test(sub)
      )
    case 'protocol':
      if (name !== 'allow') return false
      if (sub !== null && sub.toLowerCase() !== 'ext') return false
      return v.toLowerCase() !== 'never'
    default:
      return false
  }
}

/**
 * Given the output of `git config --local --includes --null --list`, return the
 * repo-local settings that make git EXECUTE something (a filter driver, an ssh
 * command, a credential helper, …). Entries are NUL-separated `key\nvalue`; a
 * key with no `=` (a bare boolean) has no newline. Values are truncated for
 * display.
 */
export function detectExecConfig(output: string): ExecConfigEntry[] {
  const found: ExecConfigEntry[] = []
  for (const raw of output.split('\0')) {
    if (!raw) continue
    const nl = raw.indexOf('\n')
    const key = nl < 0 ? raw : raw.slice(0, nl)
    const value = nl < 0 ? '' : raw.slice(nl + 1)
    if (isExecKey(key, value)) found.push({ key, value: truncate(value) })
  }
  return found
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

/** Read-only. `--includes` matters: `--local` alone does NOT follow
 * `include.path`, but git itself does at run time, so an included file could
 * otherwise smuggle in a filter driver the list never shows. */
const readLocalConfig: LocalConfigReader = (root) =>
  git(root).raw(['config', '--local', '--includes', '--null', '--list'])

/**
 * The exec-capable local config keys standing between the user and a git write
 * or network operation on `root`, or [] when the repo is trusted for this
 * session or has none. Outside a repository there is no local config: the
 * operation itself will report that.
 */
export async function pendingExecConfig(
  root: string,
  reader: LocalConfigReader = readLocalConfig
): Promise<ExecConfigEntry[]> {
  if (isRepoTrusted(root)) return []
  let output: string
  try {
    output = await reader(root)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/not a git repository|only be used inside a git repository/i.test(msg)) return []
    throw e
  }
  return detectExecConfig(output)
}
