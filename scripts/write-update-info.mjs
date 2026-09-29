// Usage: node scripts/write-update-info.mjs <artifact> <out.yml>
// Writes an electron-builder style update-info file (with the artifact's sha512)
// for a single build artifact. The mac CI jobs run this once per architecture and
// upload latest-mac-arm64.yml / latest-mac-x64.yml: electron-builder's own single
// latest-mac.yml would be raced by the two parallel mac jobs, each holding one arch.
import { readFileSync, writeFileSync } from 'node:fs'
import { updateInfoForArtifact } from './updateInfo.mjs'

const [artifact, out] = process.argv.slice(2)
if (!artifact || !out) {
  console.error('usage: node scripts/write-update-info.mjs <artifact> <out.yml>')
  process.exit(2)
}
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
writeFileSync(out, await updateInfoForArtifact(artifact, version, new Date().toISOString()))
console.log(`wrote ${out} for ${artifact}`)
