import { describe, it, expect } from 'vitest'
import { previewKindFor } from '../../src/renderer/src/components/terminal/previewKind'

describe('previewKindFor', () => {
  it('classifies images by extension', () => {
    for (const p of ['logo.png', 'a/b/photo.JPG', 'icon.svg', 'x.webp', 'y.avif']) {
      expect(previewKindFor(p)).toBe('image')
    }
  })

  it('classifies markdown', () => {
    expect(previewKindFor('README.md')).toBe('markdown')
    expect(previewKindFor('docs/Guide.MARKDOWN')).toBe('markdown')
    expect(previewKindFor('notes.mdx')).toBe('markdown')
  })

  it('treats everything else as code', () => {
    expect(previewKindFor('src/app.tsx')).toBe('code')
    expect(previewKindFor('main.py')).toBe('code')
    expect(previewKindFor('Makefile')).toBe('code')
  })

  it('treats dotfiles (leading-dot, no other dot) as code, not by their "extension"', () => {
    expect(previewKindFor('.gitignore')).toBe('code')
    expect(previewKindFor('.md')).toBe('code')
  })

  it('uses only the basename, ignoring directory names with dots', () => {
    expect(previewKindFor('my.assets/diagram.png')).toBe('image')
    expect(previewKindFor('v1.2/notes.md')).toBe('markdown')
  })
})
