/**
 * Result is the single shape every IPC handler returns. The renderer never sees
 * a thrown exception or a raw stack trace — only `{ ok: true, value }` or
 * `{ ok: false, error: { code, message } }` with a stable machine-readable code.
 */

export type ErrorCode =
  | 'UNKNOWN'
  | 'VALIDATION'
  | 'JAIL_VIOLATION'
  | 'NOT_FOUND'
  | 'IO'
  | 'EXISTS'
  | 'BINARY'
  | 'TOO_LARGE'
  | 'CONFLICT'
  | 'CANCELED'
  | 'NOT_REPO'
  | 'EMPTY_REPO'
  | 'NO_UPSTREAM'
  | 'AUTH_WAIT'
  | 'MERGE_CONFLICT'
  | 'DETACHED'
  | 'NETWORK'
  | 'GIT'

export interface Ok<T> {
  ok: true
  value: T
}

export interface Err {
  ok: false
  error: { code: ErrorCode; message: string }
}

export type Result<T> = Ok<T> | Err

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err(code: ErrorCode, message: string): Err {
  return { ok: false, error: { code, message } }
}
