/** What kind of preview to render for a file path. Pure + unit-testable. */
export type PreviewKind = 'image' | 'markdown' | 'code'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx'])

export function previewKindFor(path: string): PreviewKind {
  const base = path.split(/[\\/]/).pop() ?? path
  const dot = base.lastIndexOf('.')
  // dot must be after the first char so dotfiles (.gitignore) are treated as code.
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  if (IMAGE_EXT.has(ext)) return 'image'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  return 'code'
}
