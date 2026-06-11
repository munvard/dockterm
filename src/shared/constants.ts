export const APP_NAME = 'DockTerm'
export const APP_ID = 'com.dockterm.app'

/** Directories and files never shown in the file tree or walked by the watcher. */
export const IGNORED_ENTRIES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.DS_Store'
]

/** Editor refuses to open anything larger than this (bytes) or containing NUL. */
export const MAX_EDIT_FILE_BYTES = 1.5 * 1024 * 1024

/** Safety cap on how many entries a single directory read returns. */
export const MAX_TREE_ENTRIES = 8000

/** PTY streaming + flow-control tuning (see ADR-002). */
export const PTY = {
  FLUSH_MS: 8,
  FLUSH_BYTES: 32 * 1024,
  HIGH_WATER: 128 * 1024,
  LOW_WATER: 32 * 1024,
  MIN_COLS: 2,
  MIN_ROWS: 2,
  MAX_COLS: 1000,
  MAX_ROWS: 1000
} as const

export const WATCH_DEBOUNCE_MS = 300
export const GIT_STATUS_DEBOUNCE_MS = 500

/** Max recent projects remembered in settings. */
export const MAX_RECENT_PROJECTS = 8

/** Rolling cap on the per-session "changed since app opened" log. */
export const SESSION_CHANGE_LOG_CAP = 1000
