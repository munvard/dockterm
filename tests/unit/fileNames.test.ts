import { describe, expect, it } from 'vitest'
import { duplicateName, validEntryName } from '@shared/fileNames'

describe('duplicateName', () => {
  it('adds " copy" before the extension', () => {
    expect(duplicateName('report.txt', new Set(['report.txt']))).toBe('report copy.txt')
  })
  it('numbers further copies', () => {
    expect(duplicateName('a.txt', new Set(['a.txt', 'a copy.txt', 'a copy 2.txt']))).toBe('a copy 3.txt')
  })
  it('handles dotfiles and no extension', () => {
    expect(duplicateName('.env', new Set())).toBe('.env copy')
    expect(duplicateName('Makefile', new Set())).toBe('Makefile copy')
  })
})

describe('validEntryName', () => {
  it('accepts normal names', () => {
    expect(validEntryName('index.ts')).toBeNull()
    expect(validEntryName('.gitignore')).toBeNull()
  })
  it('rejects separators, empty and dot names', () => {
    expect(validEntryName('')).not.toBeNull()
    expect(validEntryName('..')).not.toBeNull()
    expect(validEntryName('a/b')).not.toBeNull()
    expect(validEntryName('a\\b')).not.toBeNull()
  })
})
