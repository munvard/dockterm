import { describe, it, expect } from 'vitest'
import { safeUrl, isSecretKey, keysOf, looksLikeSecret, maskCommandLine, MASK } from '@main/services/secretMask'

describe('safeUrl', () => {
  it('keeps scheme, host, and path', () => {
    expect(safeUrl('https://mcp.example.com/endpoint')).toBe('https://mcp.example.com/endpoint')
  })
  it('drops query strings (which may carry tokens)', () => {
    expect(safeUrl('https://mcp.example.com/x?token=abc123')).toBe('https://mcp.example.com/x')
  })
  it('drops embedded credentials', () => {
    expect(safeUrl('https://user:pass@mcp.example.com/')).toBe('https://mcp.example.com')
  })
  it('never leaks embedded credentials or query tokens', () => {
    const masked = safeUrl('https://user:supersecret@host.com/p?token=abc123')
    expect(masked).not.toContain('supersecret')
    expect(masked).not.toContain('abc123')
  })
  it('masks a high-entropy path segment (e.g. a Slack incoming-webhook token)', () => {
    const token = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4'
    const masked = safeUrl(`https://hooks.slack.com/services/T00000000/B00000000/${token}`)
    expect(masked).not.toContain(token)
    expect(masked.startsWith('https://hooks.slack.com/')).toBe(true)
  })
  it('keeps an ordinary, low-entropy path untouched', () => {
    expect(safeUrl('https://mcp.example.com/api/v1/endpoint')).toBe(
      'https://mcp.example.com/api/v1/endpoint'
    )
  })
})

describe('looksLikeSecret', () => {
  it('recognizes common token prefixes', () => {
    expect(looksLikeSecret('sk-abcdefghijklmnop1234')).toBe(true)
    expect(looksLikeSecret('ghp_abcdefghijklmnopqrstuvwxyz1234')).toBe(true)
    expect(looksLikeSecret('AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(looksLikeSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0')).toBe(true)
  })
  it('does not flag ordinary short or plain-English args', () => {
    expect(looksLikeSecret('--verbose')).toBe(false)
    expect(looksLikeSecret('production')).toBe(false)
    expect(looksLikeSecret('@example/mcp@latest')).toBe(false)
  })
})

describe('maskCommandLine', () => {
  it('masks the value of a --flag=value secret-named flag', () => {
    expect(maskCommandLine('npx', ['-y', '@foo/mcp', '--api-key=sk-abcdefghijklmnop'])).toBe(
      `npx -y @foo/mcp --api-key=${MASK}`
    )
  })
  it('masks the bare arg following a secret-named flag', () => {
    expect(maskCommandLine('foo', ['--token', 'abcdefghijklmnopqrstuvwx'])).toBe(`foo --token ${MASK}`)
  })
  it('masks the bare arg following --header and -e/--env', () => {
    expect(maskCommandLine('foo', ['--header', 'Authorization: Bearer xyz'])).toBe(
      `foo --header ${MASK}`
    )
    expect(maskCommandLine('foo', ['-e', 'SOME_SECRET_VALUE'])).toBe(`foo -e ${MASK}`)
  })
  it('masks a KEY=VALUE pair whose key looks like a secret', () => {
    expect(maskCommandLine('foo', ['API_TOKEN=abcdefghijklmnop1234'])).toBe(`foo API_TOKEN=${MASK}`)
  })
  it('masks a bare token-shaped argument even with no flag context', () => {
    expect(maskCommandLine('foo', ['sk-abcdefghijklmnop1234'])).toBe(`foo ${MASK}`)
  })
  it('masks an embedded URL via safeUrl', () => {
    expect(maskCommandLine('foo', ['--url', 'https://user:pw@host.com/x?token=abc'])).toContain(
      'https://host.com'
    )
  })
  it('leaves non-secret args untouched', () => {
    expect(maskCommandLine('npx', ['-y', '@example/mcp@latest'])).toBe('npx -y @example/mcp@latest')
  })
})

describe('isSecretKey', () => {
  it('flags common secret keys', () => {
    expect(isSecretKey('API_KEY')).toBe(true)
    expect(isSecretKey('Authorization')).toBe(true)
    expect(isSecretKey('GITHUB_TOKEN')).toBe(true)
  })
  it('does not flag innocuous keys', () => {
    expect(isSecretKey('PORT')).toBe(false)
    expect(isSecretKey('NODE_ENV')).toBe(false)
  })
})

describe('keysOf', () => {
  it('returns object keys', () => {
    expect(keysOf({ A: '1', B: '2' })).toEqual(['A', 'B'])
  })
  it('returns empty for non-objects', () => {
    expect(keysOf(undefined)).toEqual([])
    expect(keysOf(['a'])).toEqual([])
    expect(keysOf('x')).toEqual([])
  })
})
