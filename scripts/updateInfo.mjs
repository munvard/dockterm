import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'

/** sha512 of a file as electron-builder writes it: base64. */
export async function sha512Base64(path) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

/**
 * An electron-builder style update-info file for ONE artifact: the same
 * `version` / `files` / `path` / `sha512` / `releaseDate` layout its own
 * latest*.yml uses, so the app's parser reads it the same way. Deterministic
 * for a given input (no clock read here).
 */
export function buildUpdateInfoYml({ version, url, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${url}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    ''
  ].join('\n')
}

/** Build the update-info text for the artifact file at `artifactPath`. */
export async function updateInfoForArtifact(artifactPath, version, releaseDate) {
  return buildUpdateInfoYml({
    version,
    url: basename(artifactPath),
    sha512: await sha512Base64(artifactPath),
    size: (await stat(artifactPath)).size,
    releaseDate
  })
}
