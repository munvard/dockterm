// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdownPreview } from '../../src/renderer/src/components/terminal/markdown'

describe('renderMarkdownPreview', () => {
  it('renders ordinary markdown', () => {
    const html = renderMarkdownPreview('**bold** and a [link](https://example.com)')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a href="https://example.com">link</a>')
  })

  it('escapes a raw <style> block instead of injecting it', () => {
    const html = renderMarkdownPreview('before\n\n<style>body{display:none}</style>\n\nafter')
    expect(html).not.toContain('<style>')
    expect(html).toContain('&lt;style&gt;')
    expect(html).toContain('before')
    expect(html).toContain('after')
  })

  it('does not let a raw <details> block swallow the rest of the message', () => {
    const html = renderMarkdownPreview('<details><summary>hidden</summary>the rest of the message</details>')
    expect(html).not.toContain('<details>')
    expect(html).toContain('the rest of the message')
  })

  it('escapes raw <textarea> and <select> instead of rendering them as form controls', () => {
    const html = renderMarkdownPreview('<textarea>x</textarea><select><option>y</option></select>')
    expect(html).not.toContain('<textarea>')
    expect(html).not.toContain('<select>')
  })

  it('escapes an inline HTML tag in prose as literal text', () => {
    const html = renderMarkdownPreview('Use a <div> element here.')
    expect(html).toContain('&lt;div&gt;')
    expect(html).not.toMatch(/<div>/)
  })
})
