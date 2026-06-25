import { describe, it, expect } from 'vitest'
import { launchCommand } from '../../src/renderer/src/components/terminal/launcherCommands'

describe('launchCommand', () => {
  it('maps each launcher action to the right claude command (with a submitting CR)', () => {
    expect(launchCommand('new')).toBe('claude\r')
    expect(launchCommand('resume')).toBe('claude --resume\r')
    expect(launchCommand('continue')).toBe('claude --continue\r')
  })
})
