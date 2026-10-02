export type ShellKind = 'posix' | 'powershell' | 'cmd'

const POSIX_SAFE = /^[A-Za-z0-9_\-./,:@%+=]+$/
const PS_SAFE = /^[A-Za-z0-9_./\\:,@%+=][A-Za-z0-9_\-./\\:,@%+=]*$/

/** Which shell a pane most likely runs: a Windows pane is PowerShell unless its shell path says cmd. */
export function shellKindFor(platform: string, shellPath = ''): ShellKind {
  if (platform !== 'win32') return 'posix'
  return /(^|[\\/])cmd(\.exe)?$/i.test(shellPath) ? 'cmd' : 'powershell'
}

/**
 * Quote one path argument for a shell. posix and PowerShell use single quotes (nothing
 * inside expands; the quote itself is escaped or doubled). cmd has only double quotes,
 * which cannot hold a literal `"` (Windows paths never do), and an interactive cmd
 * line always expands `%NAME%`, which no quoting can stop.
 */
export function quoteShellArg(p: string, shell: ShellKind): string {
  if (p === '') return shell === 'cmd' ? '""' : "''"
  switch (shell) {
    case 'posix':
      return POSIX_SAFE.test(p) && p[0] !== '-' ? p : `'${p.replace(/'/g, `'\\''`)}'`
    case 'powershell':
      return PS_SAFE.test(p) ? p : `'${p.replace(/['\u2018\u2019\u201A\u201B]/g, (q) => q + q)}'`
    case 'cmd':
      return /^[A-Za-z0-9_\-./\\:,@+=]+$/.test(p) ? p : `"${p.replace(/"/g, '')}"`
  }
}

/** The line that changes a shell's directory to `dir` (no trailing newline: the user presses Enter). */
export function cdCommand(dir: string, shell: ShellKind): string {
  const q = quoteShellArg(dir, shell)
  switch (shell) {
    case 'posix':
      return `cd -- ${q}`
    case 'powershell':
      return `Set-Location -LiteralPath ${q}`
    case 'cmd':
      return `cd /d ${q}`
  }
}
