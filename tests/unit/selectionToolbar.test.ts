import { describe, it, expect } from 'vitest'
import {
  wrapBracketedPaste,
  clampToolbar,
  buildClaudeReference,
  quotePath
} from '../../src/renderer/src/components/terminal/terminalSelection'

describe('wrapBracketedPaste', () => {
  it('wraps text in bracketed-paste markers so multi-line lands unsubmitted', () => {
    expect(wrapBracketedPaste('a\nb')).toBe('\x1b[200~a\nb\x1b[201~')
  })
})

describe('buildClaudeReference', () => {
  it('frames a single line as inline code with a trailing newline for the question', () => {
    expect(buildClaudeReference('npm run build')).toBe(
      'Referencing this from my terminal: `npm run build`\n'
    )
  })

  it('uses quotes instead of inline code when the line contains a backtick', () => {
    expect(buildClaudeReference('use `cd` first')).toBe(
      'Referencing this from my terminal: "use `cd` first"\n'
    )
  })

  it('frames multiple lines as a markdown blockquote', () => {
    expect(buildClaudeReference("Error: x\n  at require")).toBe(
      'Referencing this from my terminal:\n\n> Error: x\n>   at require\n\n'
    )
  })

  it('normalizes CRLF and trims trailing blank lines before framing', () => {
    expect(buildClaudeReference('a\r\nb\n\n')).toBe(
      'Referencing this from my terminal:\n\n> a\n> b\n\n'
    )
  })

  it('returns an empty string for an empty/whitespace-only selection', () => {
    expect(buildClaudeReference('')).toBe('')
    expect(buildClaudeReference('\n\n')).toBe('')
  })
})

describe('quotePath', () => {
  it('leaves a plain path unquoted', () => {
    expect(quotePath('src/app.ts', 'darwin')).toBe('src/app.ts')
    expect(quotePath('src/app.ts', 'win32')).toBe('src/app.ts')
  })

  it('POSIX: single-quotes a path with a space', () => {
    expect(quotePath('my folder/file.ts', 'darwin')).toBe("'my folder/file.ts'")
    expect(quotePath('my folder/file.ts', 'linux')).toBe("'my folder/file.ts'")
  })

  it('POSIX: does not let $() or backticks expand inside the quotes', () => {
    // A double-quoted path would still let bash/zsh run $(...) and `...`: the
    // fix was to single-quote, which treats the whole thing literally.
    const evil = 'notes ($(rm -rf ~))'
    const quoted = quotePath(evil, 'darwin')
    expect(quoted).toBe("'notes ($(rm -rf ~))'")
    expect(quoted.startsWith('"')).toBe(false)
  })

  it('POSIX: escapes an embedded single quote', () => {
    expect(quotePath("O'Brien's notes", 'darwin')).toBe(`'O'\\''Brien'\\''s notes'`)
  })

  it('Windows (PowerShell): single-quotes a path with a space and doubles embedded quotes', () => {
    expect(quotePath('my folder\\file.ts', 'win32')).toBe("'my folder\\file.ts'")
    expect(quotePath("O'Brien\\a b.ts", 'win32')).toBe("'O''Brien\\a b.ts'")
    expect(quotePath('it\u2019s a.ts', 'win32')).toBe("'it\u2019\u2019s a.ts'")
  })

  it('Windows: $var and backticks stay literal (double quotes would expand them)', () => {
    expect(quotePath('C:\\a$b.txt', 'win32')).toBe("'C:\\a$b.txt'")
    expect(quotePath('C:\\a`n.txt', 'win32')).toBe("'C:\\a`n.txt'")
  })

  it('quotes a path containing shell metacharacters even without whitespace', () => {
    expect(quotePath('weird&name.ts', 'darwin')).toBe("'weird&name.ts'")
  })
})

describe('clampToolbar', () => {
  const size = { w: 160, h: 28 }
  const vp = { w: 1000, h: 800 }

  it('centers the toolbar above the anchor when there is room', () => {
    const p = clampToolbar({ x: 500, y: 400 }, size, vp)
    expect(p.x).toBe(500 - 80) // centered
    expect(p.y).toBe(400 - 28 - 8) // above by height + gap
  })

  it('flips below the anchor when too close to the top', () => {
    const p = clampToolbar({ x: 500, y: 10 }, size, vp)
    expect(p.y).toBe(10 + 8) // below the anchor
  })

  it('clamps to the right edge', () => {
    const p = clampToolbar({ x: 995, y: 400 }, size, vp)
    expect(p.x).toBe(vp.w - size.w - 8)
  })

  it('clamps to the left edge', () => {
    const p = clampToolbar({ x: 2, y: 400 }, size, vp)
    expect(p.x).toBe(8)
  })
})
