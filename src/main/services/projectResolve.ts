import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MANIFESTS = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml']

/**
 * Maps a terminal's cwd to its project root: nearest ancestor with `.git`,
 * else nearest ancestor with a known manifest, else the cwd itself.
 * `exists` is injectable for tests (mirrors the pattern in shellDetect).
 */
export function resolveProjectRoot(
  cwd: string,
  exists: (p: string) => boolean = existsSync
): string {
  let manifestHit: string | null = null
  let dir = cwd
  for (;;) {
    if (exists(join(dir, '.git'))) return dir
    if (!manifestHit && MANIFESTS.some((m) => exists(join(dir, m)))) manifestHit = dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return manifestHit ?? cwd
}
