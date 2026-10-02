import { describe, expect, it } from 'vitest'
import { isSafeRelPath } from '@shared/search/relPath'
import { watchSchema } from '../../../src/main/search/watchSchema'

describe('isSafeRelPath', () => {
  it('accepts plain relative paths', () => {
    for (const p of ['a.ts', 'src/app.ts', 'dir\\file.txt', '.env', 'a..b/c', '...x']) expect(isSafeRelPath(p), p).toBe(true)
  })
  it('refuses parent, current, absolute, drive-letter, UNC and NUL paths', () => {
    for (const p of ['', '..', '../x', 'a/../../x', 'a\\..\\x', '.', './x', '/etc/passwd', '\\\\host\\share', 'C:/x', 'c:\\x', 'C:x', 'a\0b']) {
      expect(isSafeRelPath(p), JSON.stringify(p)).toBe(false)
    }
  })
})

describe('search:applyWatch schema', () => {
  it('rejects an event with an unsafe path', () => {
    expect(watchSchema.safeParse({ events: [{ type: 'add', relPath: '../x' }] }).success).toBe(false)
    expect(watchSchema.safeParse({ events: [{ type: 'add', relPath: 'C:/x' }] }).success).toBe(false)
    expect(watchSchema.safeParse({ events: [{ type: 'add', relPath: 'src/x.ts' }] }).success).toBe(true)
  })
})
