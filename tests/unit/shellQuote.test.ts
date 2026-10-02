import { describe, expect, it } from 'vitest'
import { cdCommand, quoteShellArg, shellKindFor } from '../../src/shared/shellQuote'

describe('quoteShellArg', () => {
  it('leaves a plain posix path alone and quotes anything with a space or metacharacter', () => {
    expect(quoteShellArg('/Users/me/src/app.ts', 'posix')).toBe('/Users/me/src/app.ts')
    expect(quoteShellArg('/Users/me/My Project', 'posix')).toBe(`'/Users/me/My Project'`)
    expect(quoteShellArg('a$b;c', 'posix')).toBe(`'a$b;c'`)
    expect(quoteShellArg('`rm -rf`', 'posix')).toBe("'`rm -rf`'")
  })
  it('escapes a single quote in posix', () => {
    expect(quoteShellArg("it's here", 'posix')).toBe(`'it'\\''s here'`)
  })
  it('quotes a path that starts with a dash so it is not read as an option', () => {
    expect(quoteShellArg('-rf', 'posix')).toBe(`'-rf'`)
  })
  it('PowerShell: bare for safe paths, single quotes with doubled quotes otherwise', () => {
    expect(quoteShellArg('C:\\Users\\me\\app.ts', 'powershell')).toBe('C:\\Users\\me\\app.ts')
    expect(quoteShellArg('C:\\My Project\\a.ts', 'powershell')).toBe(`'C:\\My Project\\a.ts'`)
    expect(quoteShellArg("C:\\it's\\a.ts", 'powershell')).toBe(`'C:\\it''s\\a.ts'`)
    expect(quoteShellArg('C:\\a\u2019b', 'powershell')).toBe(`'C:\\a\u2019\u2019b'`)
    expect(quoteShellArg('a$b', 'powershell')).toBe(`'a$b'`)
    expect(quoteShellArg('(x)', 'powershell')).toBe(`'(x)'`)
    expect(quoteShellArg('-Force', 'powershell')).toBe(`'-Force'`)
  })
  it('cmd: double quotes when needed, bare otherwise', () => {
    expect(quoteShellArg('C:\\Users\\me', 'cmd')).toBe('C:\\Users\\me')
    expect(quoteShellArg('C:\\My Project', 'cmd')).toBe('"C:\\My Project"')
    expect(quoteShellArg('C:\\a&b', 'cmd')).toBe('"C:\\a&b"')
  })
  it('an empty path is an empty quoted string', () => {
    expect(quoteShellArg('', 'posix')).toBe("''")
    expect(quoteShellArg('', 'cmd')).toBe('""')
  })
})

describe('cdCommand', () => {
  it('uses each shell\'s own change-directory form', () => {
    expect(cdCommand('/a b', 'posix')).toBe(`cd -- '/a b'`)
    expect(cdCommand('C:\\a b', 'powershell')).toBe(`Set-Location -LiteralPath 'C:\\a b'`)
    expect(cdCommand('D:\\x', 'cmd')).toBe('cd /d D:\\x')
  })
})

describe('shellKindFor', () => {
  it('posix off Windows, PowerShell by default on Windows, cmd when the shell is cmd', () => {
    expect(shellKindFor('darwin')).toBe('posix')
    expect(shellKindFor('linux', '/bin/zsh')).toBe('posix')
    expect(shellKindFor('win32')).toBe('powershell')
    expect(shellKindFor('win32', 'C:\\Windows\\System32\\cmd.exe')).toBe('cmd')
    expect(shellKindFor('win32', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell')
  })
})
