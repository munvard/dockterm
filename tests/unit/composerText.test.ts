import { describe, it, expect } from 'vitest'
import {
  buildImagePaste,
  buildPromptText,
  countImageMarkers,
  expandPasted,
  fileRef,
  formatPathForClaude,
  isImagePath,
  absolutize,
  liveChips,
  pastedToken,
  relativeInside,
  type Attachment
} from '../../src/renderer/src/components/chat/composerText'
import {
  chipLabel,
  insertAtCaret,
  isLargePaste,
  lineCount,
  pasteText
} from '../../src/renderer/src/components/chat/composerPaste'

const file = (path: string, kind: 'file' | 'dir' = 'file'): Attachment => ({
  id: path,
  kind,
  path,
  name: path.split('/').pop() ?? path
})

describe('image paths', () => {
  it('recognises the four image types only', () => {
    expect(isImagePath('/a/b.PNG')).toBe(true)
    expect(isImagePath('/a/b.jpeg')).toBe(true)
    expect(isImagePath('/a/b.webp')).toBe(true)
    expect(isImagePath('/a/b.svg')).toBe(false)
    expect(isImagePath('/a/b.png.txt')).toBe(false)
  })
  it('quotes a path with whitespace, leaves others alone', () => {
    expect(formatPathForClaude('/tmp/a.png', 'darwin')).toBe('/tmp/a.png')
    expect(formatPathForClaude('/tmp/My Shot.png', 'darwin')).toBe('"/tmp/My Shot.png"')
  })
  it('uses forward slashes on win32', () => {
    expect(formatPathForClaude('C:\\Users\\me\\a.png', 'win32')).toBe('C:/Users/me/a.png')
    expect(formatPathForClaude('C:\\Users\\my name\\a.png', 'win32')).toBe('"C:/Users/my name/a.png"')
    expect(formatPathForClaude('C:\\Users\\me\\a.png', 'linux')).toBe('C:\\Users\\me\\a.png')
  })
  it('joins several images by newline in a bracketed paste, by space otherwise', () => {
    expect(buildImagePaste(['/a.png', '/b c.png'], 'darwin', true)).toBe('/a.png\n"/b c.png"')
    expect(buildImagePaste(['/a.png', '/b.png'], 'darwin', false)).toBe('/a.png /b.png')
  })
})

describe('relativeInside / fileRef', () => {
  it('gives the relative path inside the root', () => {
    expect(relativeInside('/p', '/p/src/a.ts', 'darwin')).toBe('src/a.ts')
    expect(relativeInside('/p/', '/p/src/a.ts', 'darwin')).toBe('src/a.ts')
  })
  it('is null for the root itself, siblings and outside paths', () => {
    expect(relativeInside('/p', '/p', 'darwin')).toBeNull()
    expect(relativeInside('/p', '/p2/a.ts', 'darwin')).toBeNull()
    expect(relativeInside('/p', '/q/a.ts', 'darwin')).toBeNull()
    expect(relativeInside(null, '/q/a.ts', 'darwin')).toBeNull()
  })
  it('matches Windows paths case-insensitively with any slash', () => {
    expect(relativeInside('C:\\Proj', 'c:\\proj\\src\\a.ts', 'win32')).toBe('src/a.ts')
  })
  it('expands to @relative inside the root, absolute outside', () => {
    expect(fileRef('/p/src/a.ts', '/p', 'darwin')).toBe('@src/a.ts')
    expect(fileRef('/other/a.ts', '/p', 'darwin')).toBe('/other/a.ts')
    expect(fileRef('/other/my file.ts', '/p', 'darwin')).toBe('"/other/my file.ts"')
    expect(fileRef('/p/my dir/a.ts', '/p', 'darwin')).toBe('@"my dir/a.ts"')
    expect(fileRef('D:\\x\\a b.ts', 'C:\\p', 'win32')).toBe('"D:/x/a b.ts"')
  })
})

describe('pasted text chips', () => {
  const chips = [
    { id: 1, text: 'AAA\nBBB' },
    { id: 2, text: 'costs $& and $1' }
  ]
  it('expands each token in place, keeping $ patterns literal', () => {
    const t = `before ${pastedToken(1)} middle ${pastedToken(2)} after ${pastedToken(1)}`
    expect(expandPasted(t, chips)).toBe('before AAA\nBBB middle costs $& and $1 after AAA\nBBB')
  })
  it('leaves an unknown token untouched', () => {
    expect(expandPasted('x [Pasted text #9]', chips)).toBe('x [Pasted text #9]')
  })
  it('drops chips whose token was deleted', () => {
    expect(liveChips(`only ${pastedToken(2)}`, chips).map((c) => c.id)).toEqual([2])
  })
})

describe('buildPromptText', () => {
  const base = { chips: [], files: [], root: '/p', platform: 'darwin' as const, hadImages: false }
  it('is the trimmed text when nothing is attached', () => {
    expect(buildPromptText({ ...base, text: '  hi  ' })).toBe('hi')
  })
  it('puts a leading space after images', () => {
    expect(buildPromptText({ ...base, text: 'what is this', hadImages: true })).toBe(' what is this')
    expect(buildPromptText({ ...base, text: '', hadImages: true })).toBe(' ')
  })
  it('appends file refs on their own line, in order', () => {
    const out = buildPromptText({
      ...base,
      text: 'compare',
      files: [file('/p/a.ts'), file('/x/b c.ts'), file('/p/dir', 'dir')]
    })
    expect(out).toBe('compare\n@a.ts "/x/b c.ts" @dir')
  })
  it('sends only refs when there is no text', () => {
    expect(buildPromptText({ ...base, text: '', files: [file('/p/a.ts')] })).toBe('@a.ts')
  })
  it('expands chips before appending refs', () => {
    const out = buildPromptText({
      ...base,
      text: `see ${pastedToken(1)}`,
      chips: [{ id: 1, text: 'LOG' }],
      files: [file('/p/a.ts')],
      hadImages: true
    })
    expect(out).toBe(' see LOG\n@a.ts')
  })
})

describe('countImageMarkers', () => {
  it('counts [Image # markers', () => {
    expect(countImageMarkers('❯ [Image #1] [Image #2] hi')).toBe(2)
    expect(countImageMarkers('nothing')).toBe(0)
  })
})

describe('paste rules', () => {
  it('flags > 40 lines or > 4000 chars, not exactly 40 lines', () => {
    expect(isLargePaste(Array(40).fill('x').join('\n'))).toBe(false)
    expect(isLargePaste(Array(41).fill('x').join('\n'))).toBe(true)
    expect(isLargePaste('x'.repeat(4000))).toBe(false)
    expect(isLargePaste('x'.repeat(4001))).toBe(true)
  })
  it('labels the chip with the line count', () => {
    expect(lineCount('a\nb\nc')).toBe(3)
    expect(chipLabel('a\nb\nc')).toBe('Pasted text · 3 lines')
    expect(chipLabel('a')).toBe('Pasted text · 1 line')
  })
  it('converts structural html to markdown, else plain, and honours plain-only', () => {
    const html = '<ul><li>a</li><li>b</li></ul>'
    const p = { text: 'a\r\nb', html, types: ['text/plain', 'text/html'] }
    expect(pasteText(p)).toBe('- a\n- b')
    expect(pasteText(p, true)).toBe('a\nb')
    expect(pasteText({ ...p, types: [...p.types, 'vscode-editor-data'] })).toBe('a\nb')
    expect(pasteText({ text: 'hi', html: '<span>hi</span>', types: [] })).toBe('hi')
    expect(pasteText({ text: 'hi', html: '', types: [] })).toBe('hi')
  })
  it('inserts at the caret, replacing a selection', () => {
    expect(insertAtCaret('hello world', 6, 11, 'there')).toEqual({ value: 'hello there', caret: 11 })
    expect(insertAtCaret('ab', 1, 1, 'X')).toEqual({ value: 'aXb', caret: 2 })
  })
})

describe('absolutize', () => {
  it('leaves absolute paths and joins relative ones to the root', () => {
    expect(absolutize('/p', '/x/a.ts', 'darwin')).toBe('/x/a.ts')
    expect(absolutize('/p/', 'src/a.ts', 'darwin')).toBe('/p/src/a.ts')
    expect(absolutize('/p', './a.ts', 'linux')).toBe('/p/a.ts')
    expect(absolutize(null, 'a.ts', 'darwin')).toBe('a.ts')
    expect(absolutize('C:\\p', 'src\\a.ts', 'win32')).toBe('C:\\p\\src\\a.ts')
    expect(absolutize('C:\\p', 'D:\\x\\a.ts', 'win32')).toBe('D:\\x\\a.ts')
  })
})
