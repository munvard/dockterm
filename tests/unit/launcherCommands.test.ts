import { describe, it, expect } from 'vitest'
import { launchCommand } from '../../src/renderer/src/components/terminal/launcherCommands'

describe('launchCommand', () => {
  it('maps each launcher action to the right claude command (with a submitting CR)', () => {
    expect(launchCommand('new')).toBe('claude\r')
    expect(launchCommand('resume')).toBe('claude --resume\r')
    expect(launchCommand('continue')).toBe('claude --continue\r')
  })

  it('types plain claude when no capture flag is given (hooked shell or capture off)', () => {
    expect(launchCommand('new', null)).toBe('claude\r')
    expect(launchCommand('resume', undefined)).toBe('claude --resume\r')
  })

  it('puts the capture flag right after claude, before the launcher option', () => {
    const flag = `--settings "C:\\Users\\Me Me\\AppData\\Roaming\\DockTerm\\usage-capture\\claude-settings.json"`
    expect(launchCommand('new', flag)).toBe(`claude ${flag}\r`)
    expect(launchCommand('resume', flag)).toBe(`claude ${flag} --resume\r`)
    expect(launchCommand('continue', flag)).toBe(`claude ${flag} --continue\r`)
  })

  it('every command still starts with claude and ends with a single CR', () => {
    for (const action of ['new', 'resume', 'continue'] as const) {
      const cmd = launchCommand(action, `--settings '/p'`)
      expect(cmd.startsWith('claude')).toBe(true)
      expect(cmd.endsWith('\r')).toBe(true)
      expect(cmd.indexOf('\r')).toBe(cmd.length - 1)
    }
  })
})
