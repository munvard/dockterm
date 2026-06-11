import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface ShellSpec {
  file: string
  args: string[]
}

export interface DetectOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Injectable for tests; defaults to fs.existsSync. */
  exists?: (p: string) => boolean
}

/**
 * Chooses the shell to spawn and the args that make it behave like a normal
 * interactive login shell:
 *   - Windows: pwsh.exe (if on PATH) -> Windows PowerShell -> COMSPEC/cmd.exe
 *   - macOS/Linux: $SHELL launched with `-l` so PATH / nvm / Homebrew load.
 */
export function detectShell(opts: DetectOptions = {}): ShellSpec {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const exists = opts.exists ?? existsSync

  if (platform === 'win32') {
    const pwsh = findOnPath('pwsh.exe', env, exists)
    if (pwsh) return { file: pwsh, args: ['-NoLogo'] }

    const systemRoot = env['SystemRoot'] ?? 'C:\\Windows'
    const winPowerShell = join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    if (exists(winPowerShell)) return { file: winPowerShell, args: ['-NoLogo'] }

    return { file: env['COMSPEC'] ?? 'cmd.exe', args: [] }
  }

  const shell = env['SHELL'] ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  return { file: shell, args: ['-l'] }
}

function findOnPath(
  exe: string,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean
): string | null {
  const pathVar = env['PATH'] ?? env['Path'] ?? ''
  for (const dir of pathVar.split(';')) {
    if (!dir) continue
    const full = join(dir, exe)
    if (exists(full)) return full
  }
  return null
}
