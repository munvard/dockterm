import { describe, it, expect } from 'vitest'
import { classify, parseAsk } from '@renderer/components/terminal/claudeStatus'

describe('classify', () => {
  it('detects working from the token-counter spinner line', () => {
    expect(classify('✻ Thinking… (12s · 1.2k tokens)')).toBe('working')
  })
  it('detects working from "esc to interrupt"', () => {
    expect(classify('Running tool (esc to interrupt)')).toBe('working')
  })
  it('detects asking from a numbered prompt menu', () => {
    expect(classify('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe('asking')
  })
  it('detects asking from "Esc to cancel"', () => {
    expect(classify('Enter to confirm · Esc to cancel')).toBe('asking')
  })
  it('returns idle for ordinary output', () => {
    expect(classify('$ ls\nREADME.md\n$ ')).toBe('idle')
  })
  it('prefers working over asking when both signals appear', () => {
    expect(classify('❯ 1. Yes\n✻ Thinking… running')).toBe('working')
  })
})

describe('parseAsk', () => {
  it('pulls the question/command line above the menu', () => {
    const text = 'Claude wants to run a command\n  npm install\n❯ 1. Yes\n  2. No'
    expect(parseAsk(text)).toContain('npm install')
  })
  it('returns null when not asking', () => {
    expect(parseAsk('just output')).toBeNull()
  })
})
