import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface InstalledPlugin {
  /** short plugin name (before any @version) */
  name: string
  /** install path — where the plugin's skills/, commands/, agents/, .mcp.json live */
  path: string
}

/**
 * Enumerate installed Claude Code plugins from
 * `~/.claude/plugins/installed_plugins.json`. Returns each plugin's short name +
 * its install path. Empty if the registry is missing/unreadable. Shared by the
 * MCP, skills, commands, and agents scanners so plugin-provided items show up.
 */
export function listInstalledPlugins(): InstalledPlugin[] {
  const file = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(file)) return []
  try {
    const json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as {
      plugins?: Record<string, Array<{ installPath?: string }>>
    }
    const out: InstalledPlugin[] = []
    for (const [key, installs] of Object.entries(json.plugins ?? {})) {
      const installPath = Array.isArray(installs) ? installs[installs.length - 1]?.installPath : null
      if (installPath) out.push({ name: key.split('@')[0], path: installPath })
    }
    return out
  } catch {
    return []
  }
}
