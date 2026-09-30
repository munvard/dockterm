import { describe, it, expect } from 'vitest'
import { parseModelLine, projectName } from '@renderer/components/chat/welcome'
import { markClaudeLaunch, recentlyLaunched, STARTING_WINDOW_MS } from '@renderer/state/launchTracker'

describe('parseModelLine (F6)', () => {
  it('reads the Claude Code startup header', () => {
    expect(parseModelLine(' ▐▛███▜▌   Claude Code v2.1.285\n▝▜█████▛▘  Opus 5.5 with high effort · Claude Max\n')).toBe(
      'Opus 5.5 · high effort'
    )
    expect(parseModelLine('  Sonnet 5.5 · high effort')).toBe('Sonnet 5.5 · high effort')
  })
  it('model only when no effort is shown; null when no model', () => {
    expect(parseModelLine('Haiku 4.5 · Claude Pro')).toBe('Haiku 4.5')
    expect(parseModelLine('PS C:\\proj> ')).toBeNull()
  })
})

describe('projectName', () => {
  it('takes the last folder for either slash style', () => {
    expect(projectName('D:\\dt-build\\testproj\\')).toBe('testproj')
    expect(projectName('/Users/me/proj')).toBe('proj')
    expect(projectName(null)).toBe('')
  })
})

describe('launch tracker (F4)', () => {
  it('is true for 20 s after a launch, then false', () => {
    markClaudeLaunch('l1', 1000)
    expect(recentlyLaunched('l1', 1000 + STARTING_WINDOW_MS - 1)).toBe(true)
    expect(recentlyLaunched('l1', 1000 + STARTING_WINDOW_MS)).toBe(false)
    expect(recentlyLaunched('never', 5)).toBe(false)
  })
})
