export function sha512Base64(path: string): Promise<string>
export function buildUpdateInfoYml(info: {
  version: string
  url: string
  sha512: string
  size: number
  releaseDate: string
}): string
export function updateInfoForArtifact(artifactPath: string, version: string, releaseDate: string): Promise<string>
