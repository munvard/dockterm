import type { WatchEvent } from '@shared/ipc'
import type { QuickResults } from '@shared/search/pathIndex'
import type { ContentFileResult, ContentOptions, IndexStatus } from '@shared/search/types'

export type { IndexPhase, IndexStatus, ContentOptions, ContentFileResult } from '@shared/search/types'

/** Index of the shared counters (Int32Array on a SharedArrayBuffer). */
export const SHARED = { CANCEL: 0, STORED: 1, TOTAL_LINES: 2, FILES_WITH_MATCH: 3, SCANNED: 4, SKIPPED_LARGE: 5, SKIPPED_BINARY: 6, ERRORS: 7, LENGTH: 8 } as const

export const CONTENT_CAPS = {
  /** Matching lines stored for display across the whole search. */
  MAX_STORED_LINES: 5000,
  MAX_LINES_PER_FILE: 100,
  /** Files bigger than this are skipped (and counted). */
  MAX_FILE_BYTES: 2 * 1024 * 1024
} as const

export type IndexIn =
  | { t: 'query'; id: number; owner: number; query: string; includeIgnored: boolean; kinds: 'files' | 'both'; limit: number; recent: string[] }
  | { t: 'watch'; events: WatchEvent[] }
  | { t: 'refresh' }
  | { t: 'status' }
  | { t: 'content'; id: number; opts: ContentOptions; ports: MessagePortLike[]; shared: SharedArrayBuffer }

export type IndexOut =
  | { t: 'status'; status: IndexStatus }
  | { t: 'queryResult'; id: number; owner: number; results: QuickResults; status: IndexStatus }
  | { t: 'queryStale'; id: number; owner: number }
  | { t: 'contentStart'; id: number; total: number }
  | { t: 'contentFed'; id: number }
  | { t: 'error'; message: string }

export type SearchIn =
  | { t: 'attach'; id: number; root: string; opts: ContentOptions; port: MessagePortLike; shared: SharedArrayBuffer }

export type SearchOut =
  | { t: 'progress'; id: number; files: ContentFileResult[]; scanned: number }
  | { t: 'done'; id: number; error?: string }

/** The slice of MessagePort the cores use, so they run under vitest without workers. */
export interface MessagePortLike {
  postMessage(value: unknown): void
  on(event: 'message', fn: (value: unknown) => void): unknown
  close(): void
}

/** Messages on the feeder -> scanner port. */
export type FeedMsg = { files: string[] } | { end: true }
/** Scanner -> feeder: one chunk finished (credit). */
export type AckMsg = { ack: true }
