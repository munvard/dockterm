/**
 * The two ways text gets into a pane's PTY, kept apart on purpose.
 *
 * - `write` is a raw PTY write. Everything the app sends on its own (launcher
 *   `claude\r`, prompts, munu/AskCard keys, Esc, Rewind, scroll keys) uses it,
 *   so the bytes reach the process exactly as given.
 * - `paste` goes through xterm's own `Terminal.paste`, which rewrites newlines
 *   and wraps the text in bracketed-paste markers when the app underneath has
 *   that mode on. Only a real user paste (clipboard, drag and drop, dropped
 *   paths) may use it: to a shell or to Claude, a pasted `\r` is text, not Enter.
 *
 * Both queue until the PTY session exists, as one raw stream.
 */
export interface PtyInputDeps {
  sessionId: () => string | null
  send: (sessionId: string, data: string) => void
  termPaste: (text: string) => void
}

export interface PtyInput {
  write: (text: string) => void
  paste: (text: string) => void
  /** Call once the session id is set: sends anything queued before it. */
  flush: () => void
}

export function createPtyInput(deps: PtyInputDeps): PtyInput {
  let queue = ''
  return {
    write(text) {
      const sid = deps.sessionId()
      if (sid) deps.send(sid, text)
      else queue += text
    },
    paste(text) {
      if (deps.sessionId()) deps.termPaste(text)
      else queue += text
    },
    flush() {
      const sid = deps.sessionId()
      if (!sid || !queue) return
      const data = queue
      queue = ''
      deps.send(sid, data)
    }
  }
}
