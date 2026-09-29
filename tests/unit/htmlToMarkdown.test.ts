import { describe, it, expect } from 'vitest'
import { htmlToMarkdown, shouldConvertHtml } from '../../src/renderer/src/components/chat/htmlToMarkdown'

describe('htmlToMarkdown', () => {
  it('converts headings, paragraphs and inline marks', () => {
    const md = htmlToMarkdown('<h1>Title</h1><p>Some <strong>bold</strong> and <em>it</em> and <code>x()</code>.</p><h3>Sub</h3>')
    expect(md).toBe('# Title\n\nSome **bold** and *it* and `x()`.\n\n### Sub')
  })

  it('keeps spaces outside emphasis marks', () => {
    expect(htmlToMarkdown('<p>a<b> bold </b>b</p>')).toBe('a **bold** b')
  })

  it('converts links, only http(s) and mailto', () => {
    expect(htmlToMarkdown('<p><a href="https://x.dev/a?b=1">site</a></p>')).toBe('[site](https://x.dev/a?b=1)')
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">bad</a></p>')).toBe('bad')
    expect(htmlToMarkdown('<p><a href="https://x.dev">https://x.dev</a></p>')).toBe('https://x.dev')
  })

  it('converts nested lists, ordered and unordered', () => {
    const md = htmlToMarkdown('<ul><li>one<ul><li>inner</li></ul></li><li>two</li></ul><ol start="3"><li>c</li><li>d</li></ol>')
    expect(md).toBe('- one\n  - inner\n- two\n\n3. c\n4. d')
  })

  it('handles list items without closing tags', () => {
    expect(htmlToMarkdown('<ul><li>a<li>b</ul>')).toBe('- a\n- b')
  })

  it('converts pre/code to a fenced block with language', () => {
    const md = htmlToMarkdown('<pre><code class="language-ts">const a = 1\nif (a &lt; 2) {}</code></pre>')
    expect(md).toBe('```ts\nconst a = 1\nif (a < 2) {}\n```')
  })

  it('uses a longer fence when the code contains backticks', () => {
    const md = htmlToMarkdown('<pre>```js\nx\n```</pre>')
    expect(md.startsWith('````\n')).toBe(true)
    expect(md.endsWith('\n````')).toBe(true)
  })

  it('converts blockquotes', () => {
    expect(htmlToMarkdown('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b')
  })

  it('converts an HTML table to a GFM table', () => {
    const md = htmlToMarkdown(
      '<table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Ann</td><td>3</td></tr><tr><td>Bo | x</td><td>4</td></tr></tbody></table>'
    )
    expect(md).toBe('| Name | Qty |\n| --- | --- |\n| Ann | 3 |\n| Bo \\| x | 4 |')
  })

  it('converts a spreadsheet table (no th, styles, comments) and pads short rows', () => {
    const html = `<html><body><!--StartFragment--><google-sheets-html-origin><style>td{border:1px}</style>
<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0"><colgroup><col width="100"></colgroup><tbody>
<tr><td style="x">A1</td><td>B1</td><td>C1</td></tr>
<tr><td>A2</td><td colspan="2">B2</td></tr>
<tr><td>A3</td></tr></tbody></table></google-sheets-html-origin><!--EndFragment--></body></html>`
    const md = htmlToMarkdown(html)
    expect(md).toBe('| A1 | B1 | C1 |\n| --- | --- | --- |\n| A2 | B2 |  |\n| A3 |  |  |')
  })

  it('collapses a single-cell table to its text', () => {
    expect(htmlToMarkdown('<table><tr><td>42</td></tr></table>')).toBe('42')
  })

  it('decodes entities and drops script/style', () => {
    expect(htmlToMarkdown('<p>a &amp; b &lt;c&gt; &#65;&nbsp;&#x42;</p><script>alert(1)</script><style>p{}</style>')).toBe('a & b <c> A B')
  })

  it('keeps a literal < that is not a tag', () => {
    expect(htmlToMarkdown('<p>1 < 2 and 3 > 2</p>')).toBe('1 < 2 and 3 > 2')
  })

  it('converts images with an http src and falls back to alt for data urls', () => {
    expect(htmlToMarkdown('<img src="https://x.dev/a.png" alt="logo">')).toBe('![logo](https://x.dev/a.png)')
    expect(htmlToMarkdown('<img src="data:image/png;base64,AAAA" alt="logo">')).toBe('logo')
  })
})

describe('shouldConvertHtml', () => {
  const types = ['text/plain', 'text/html']
  it('is true for structural html', () => {
    expect(shouldConvertHtml('<table><tr><td>1</td></tr></table>', types)).toBe(true)
    expect(shouldConvertHtml('<ul><li>a</li></ul>', types)).toBe(true)
    expect(shouldConvertHtml('<p>see <a href="https://x.dev">this</a></p>', types)).toBe(true)
    expect(shouldConvertHtml('<h2>x</h2>', types)).toBe(true)
  })
  it('is false for plain inline html', () => {
    expect(shouldConvertHtml('<span style="color:red">hello</span>', types)).toBe(false)
    expect(shouldConvertHtml('<p>just <b>text</b></p>', types)).toBe(false)
  })
  it('is false when it comes from VS Code', () => {
    expect(shouldConvertHtml('<div><pre>x</pre></div>', [...types, 'vscode-editor-data'])).toBe(false)
  })
  it('is false for a monospace white-space:pre wrapper without structure', () => {
    const html =
      '<meta charset="utf-8"><div style="font-family: Menlo, Monaco, monospace; white-space: pre;"><div>const a = 1</div></div>'
    expect(shouldConvertHtml(html, types)).toBe(false)
    expect(shouldConvertHtml('<pre>x</pre>' + html, types)).toBe(false)
  })
  it('still converts a monospace wrapper that holds a table', () => {
    const html = '<div style="font-family: monospace; white-space: pre"><table><tr><td>1</td></tr></table></div>'
    expect(shouldConvertHtml(html, types)).toBe(true)
  })
})
