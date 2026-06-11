import { vi } from 'vitest'

/**
 * Base mock of the `electron` module so main-process services can be unit-tested
 * under plain Node. Individual tests can override with their own `vi.mock`.
 */
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => process.env['DOCKTERM_TEST_USERDATA'] ?? `/tmp/dockterm-test-${name}`,
    getVersion: () => '0.0.0-test',
    getName: () => 'DockTerm',
    isPackaged: false
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  shell: { trashItem: vi.fn(), openExternal: vi.fn() },
  dialog: { showOpenDialog: vi.fn() }
}))
