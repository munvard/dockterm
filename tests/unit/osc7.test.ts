import { describe, it, expect } from 'vitest'
import { parseOsc7 } from '@renderer/components/terminal/osc7'

describe('parseOsc7', () => {
  it('parses a POSIX path with a host', () => {
    expect(parseOsc7('file://Menuas-MacBook-Pro/Users/menua/GlowAI-main')).toBe(
      '/Users/menua/GlowAI-main'
    )
  })

  it('parses an empty-host path (file:///…)', () => {
    expect(parseOsc7('file:///Users/x/roast-me')).toBe('/Users/x/roast-me')
  })

  it('percent-decodes spaces and special chars', () => {
    expect(parseOsc7('file://host/Users/x/GlowAI%2015.21.50')).toBe('/Users/x/GlowAI 15.21.50')
  })

  it('converts a Windows drive path', () => {
    expect(parseOsc7('file://DESKTOP/C:/Users/taron/Documents/b')).toBe(
      'C:\\Users\\taron\\Documents\\b'
    )
  })

  it('rejects non-file payloads and malformed input', () => {
    expect(parseOsc7('https://example.com/x')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
    expect(parseOsc7('')).toBeNull()
    expect(parseOsc7('garbage')).toBeNull()
  })
})
