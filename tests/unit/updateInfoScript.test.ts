import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildUpdateInfoYml, updateInfoForArtifact } from '../../scripts/updateInfo.mjs'
import { resolveExpectedSha512, parseUpdateYmlShaByUrl } from '@main/services/updateChecker'

describe('per-arch update info written by the mac CI jobs', () => {
  it('produces a file the updater resolves to the artifact real sha512', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'updinfo-'))
    try {
      const dmg = join(dir, 'DockTerm-0.31.0-mac-arm64.dmg')
      writeFileSync(dmg, 'installer bytes')
      const yml = await updateInfoForArtifact(dmg, '0.31.0', '2026-09-29T00:00:00.000Z')
      const expected = createHash('sha512').update('installer bytes').digest('base64')
      expect(resolveExpectedSha512(yml, { platform: 'darwin', arch: 'arm64', version: '0.31.0' })).toBe(expected)
      expect(resolveExpectedSha512(yml, { platform: 'darwin', arch: 'x64', version: '0.31.0' })).toBeNull()
      expect(yml).toContain('size: 15')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is deterministic for the same input', () => {
    const input = { version: '1.2.3', url: 'a-mac-x64.dmg', sha512: 'S'.repeat(86) + '==', size: 5, releaseDate: 'd' }
    expect(buildUpdateInfoYml(input)).toBe(buildUpdateInfoYml(input))
    expect(parseUpdateYmlShaByUrl(buildUpdateInfoYml(input)).get('a-mac-x64.dmg')).toBe(input.sha512)
  })
})
