import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listInstalledPlugins } from '@main/services/pluginDirs'

const ENV_KEY = 'CLAUDE_CONFIG_DIR'
const original = process.env[ENV_KEY]
let dir: string | null = null

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = original
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('listInstalledPlugins', () => {
  it('reads the registry from CLAUDE_CONFIG_DIR (the shared claudeConfigDir helper)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dockterm-plugins-'))
    mkdirSync(join(dir, 'plugins'))
    writeFileSync(
      join(dir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'demo@market': [{ installPath: '/p/demo' }] } })
    )
    process.env[ENV_KEY] = dir
    expect(listInstalledPlugins()).toEqual([{ name: 'demo', path: '/p/demo' }])
  })

  it('is empty when the registry is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'dockterm-plugins-'))
    process.env[ENV_KEY] = dir
    expect(listInstalledPlugins()).toEqual([])
  })
})
