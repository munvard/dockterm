import type { LineMatch } from './lineSearch'
import type { QuickResults } from './pathIndex'

export type IndexPhase = 'walking' | 'ignored' | 'ready'

export interface IndexStatus {
  state: 'idle' | 'indexing' | 'ready' | 'disabled'
  /** Files and folders currently indexed. */
  files: number
  dirs: number
  truncated: boolean
  /** The ignored tier (node_modules, build output, .git) has been walked. */
  ignoredDone: boolean
  phase: IndexPhase
  /** Milliseconds the last full walk took (0 while the first one runs). */
  walkMs: number
  reason?: string
}

export interface ContentOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  /** Comma separated globs; empty = everything. */
  include: string
  exclude: string
  includeIgnored: boolean
}

export interface ContentFileResult {
  relPath: string
  matches: LineMatch[]
  /** Matching lines in this file, including ones not stored. */
  totalLines: number
}

export interface ContentDone {
  canceled: boolean
  error?: string
  scanned: number
  total: number
  storedLines: number
  totalLines: number
  filesWithMatches: number
  skippedLarge: number
  skippedBinary: number
  errors: number
}

export type SearchEvent =
  | { kind: 'index'; root: string; status: IndexStatus }
  | { kind: 'content-start'; id: number; total: number }
  | { kind: 'content-progress'; id: number; files: ContentFileResult[]; scanned: number }
  | ({ kind: 'content-done'; id: number } & ContentDone)

export type { QuickResults }
