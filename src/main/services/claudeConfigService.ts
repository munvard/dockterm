import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeUrl, keysOf } from './secretMask'
import { listInstalledPlugins } from './pluginDirs'
import { getSettings } from './settingsService'
import type { McpServerView, McpSource, McpReadResult, McpTransport, McpScope } from '@shared/types'

const MCP_TEMPLATE = `{
  "mcpServers": {
    "example-http": {
      "type": "http",
      "url": "https://mcp.example.com/endpoint"
    },
    "example-stdio": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@example/mcp@latest"]
    }
  }
}
`

function inferTransport(def: Record<string, unknown>): McpTransport {
  const type = typeof def.type === 'string' ? def.type.toLowerCase() : ''
  if (type === 'http' || type === 'sse' || type === 'stdio') return type
  if (typeof def.command === 'string') return 'stdio'
  if (typeof def.url === 'string') return 'http'
  return 'unknown'
}

/** Build views from a `{ name: def }` map (the shape inside `mcpServers`, and the
 * shape of a plugin's `.mcp.json` which has no `mcpServers` wrapper). */
function serversFromMap(
  map: unknown,
  scope: McpScope,
  sourcePath: string,
  namePrefix = ''
): McpServerView[] {
  const servers: McpServerView[] = []
  if (!map || typeof map !== 'object') return servers
  for (const [name, value] of Object.entries(map as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const def = value as Record<string, unknown>
    const view: McpServerView = {
      name: namePrefix + name,
      scope,
      transport: inferTransport(def),
      envKeys: keysOf(def.env),
      headerKeys: keysOf(def.headers),
      sourcePath
    }
    if (typeof def.command === 'string') {
      const args = Array.isArray(def.args) ? def.args.map((a) => String(a)) : []
      view.command = [def.command, ...args].join(' ')
    }
    if (typeof def.url === 'string') view.url = safeUrl(def.url)
    servers.push(view)
  }
  return servers
}

function parseServers(raw: unknown, scope: McpScope, sourcePath: string): McpServerView[] {
  return serversFromMap((raw as { mcpServers?: unknown } | null)?.mcpServers, scope, sourcePath)
}

function readInto(
  file: string,
  scope: McpScope,
  sources: McpSource[],
  servers: McpServerView[]
): void {
  if (!existsSync(file)) {
    sources.push({ path: file, scope, exists: false, ok: true })
    return
  }
  try {
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
    servers.push(...parseServers(JSON.parse(text), scope, file))
    sources.push({ path: file, scope, exists: true, ok: true })
  } catch {
    sources.push({ path: file, scope, exists: true, ok: false, error: 'Could not parse JSON' })
  }
}

/**
 * Reads `~/.claude.json`, which holds MCP servers in several places:
 *  - top-level `mcpServers`        → "user" scope
 *  - `projects[<root>].mcpServers` → "local" scope (the default for `claude mcp add`)
 *  - `claudeAiMcpEverConnected`    → claude.ai account connectors (Gmail, Drive…)
 */
function readUserConfig(
  file: string,
  projectRoot: string,
  sources: McpSource[],
  servers: McpServerView[]
): void {
  if (!existsSync(file)) {
    sources.push({ path: file, scope: 'user', exists: false, ok: true })
    return
  }
  try {
    const text = readFileSync(file, 'utf8').replace(/^﻿/, '')
    const json = JSON.parse(text) as {
      projects?: Record<string, unknown>
      claudeAiMcpEverConnected?: unknown
    }
    servers.push(...parseServers(json, 'user', file))

    const projects = json.projects
    if (projects && typeof projects === 'object') {
      const key = Object.keys(projects).find(
        (k) => k === projectRoot || k.replace(/[/\\]+$/, '') === projectRoot.replace(/[/\\]+$/, '')
      )
      if (key) servers.push(...parseServers(projects[key], 'local', file))
    }

    // claude.ai account connectors are listed by name (no local command/url).
    if (Array.isArray(json.claudeAiMcpEverConnected)) {
      for (const entry of json.claudeAiMcpEverConnected) {
        if (typeof entry !== 'string' || !entry) continue
        servers.push({
          name: entry,
          scope: 'connector',
          transport: 'http',
          envKeys: [],
          headerKeys: [],
          sourcePath: file
        })
      }
    }

    sources.push({ path: file, scope: 'user', exists: true, ok: true })
  } catch {
    sources.push({ path: file, scope: 'user', exists: true, ok: false, error: 'Could not parse JSON' })
  }
}

/** Reads MCP servers contributed by installed Claude Code plugins. Each plugin's
 * `<installPath>/.mcp.json` is a direct `{ name: def }` map. */
function readPluginMcp(sources: McpSource[], servers: McpServerView[]): void {
  const registry = join(homedir(), '.claude', 'plugins', 'installed_plugins.json')
  sources.push({ path: registry, scope: 'plugin', exists: existsSync(registry), ok: true })
  for (const plugin of listInstalledPlugins()) {
    const mcpFile = join(plugin.path, '.mcp.json')
    if (!existsSync(mcpFile)) continue
    try {
      const map = JSON.parse(readFileSync(mcpFile, 'utf8').replace(/^﻿/, ''))
      servers.push(...serversFromMap(map, 'plugin', mcpFile, `${plugin.name}:`))
    } catch {
      // skip a plugin with an unparseable .mcp.json
    }
  }
}

/** Reads configured MCP servers across project, user, connector and plugin
 * scopes. User/connector/plugin scopes are only read when `includeUser` is true.
 * Secret values are never returned; only key names and a stripped URL leave main. */
export function readMcp(root: string, includeUser: boolean): McpReadResult {
  const sources: McpSource[] = []
  const servers: McpServerView[] = []
  readInto(join(root, '.mcp.json'), 'project', sources, servers)
  const customMcp = getSettings().claude.paths.mcpConfig
  if (customMcp) readInto(customMcp, 'user', sources, servers)
  if (includeUser) {
    readUserConfig(join(homedir(), '.claude.json'), root, sources, servers)
    readPluginMcp(sources, servers)
  }
  return { servers, sources }
}

export function createMcpTemplate(root: string): string {
  const file = join(root, '.mcp.json')
  if (existsSync(file)) throw new Error('.mcp.json already exists')
  writeFileSync(file, MCP_TEMPLATE, { flag: 'wx' })
  return '.mcp.json'
}
