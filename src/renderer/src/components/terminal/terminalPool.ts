import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtyDataEvent } from '@shared/ipc'
import { DEFAULT_MONO } from './terminalTheme'
import { parseOsc7 } from './osc7'
import { resolveTermKey } from './terminalKeys'
import { classify, parseAsk } from './claudeStatus'
import { createStatusHold } from './statusHold'
import { findPathLinks, columnForStringIndex, type CellSpan } from './pathLinks'
import { useThemeStore } from '../../state/useThemeStore'
import { useComposeStore } from '../../state/useComposeStore'
import { useMunuStore } from '../../state/useMunuStore'
import { paneWriters } from '../../state/paneWriters'
import { createPtyInput } from './ptyInput'
import { bundledConptyBuild } from './conptyBuild'
import {
  CLEAR_STARTING_HINT,
  RESTORE_BANNER,
  STARTING_HINT,
  STARTING_HINT_DELAY_MS,
  restoreScrollTail
} from './restoreBanner'
import {
  handleImagePasteEvent,
  pasteImageFromSystemClipboard,
  type ImagePasteDeps
} from './terminalImagePaste'
import { toComposerPlatform } from '../chat/composerText'
import { useToastStore } from '../../state/useToastStore'
import type { TerminalOptions } from './useTerminal'
import '@xterm/xterm/css/xterm.css'

const encoder = new TextEncoder()

function currentPlatform(): string {
  return document.documentElement.dataset.platform ?? ''
}

// Windows build number, for xterm's conpty-aware reflow/scrollback heuristics
// (the `windowsPty` terminal option below). Kicked off lazily on the first
// terminal creation rather than at module load: this module is imported
// (and evaluated) as part of the initial bundle, before App.tsx's effect has
// had a chance to stamp <html data-platform>, so checking the platform at
// module scope would always read '' and never fire on a real Windows box.
// A terminal created before the fetch resolves just gets xterm's
// pre-conpty-aware defaults for that one instance (safe, only less exact).
let winBuildNumber: number | undefined
let winBuildKicked = false
function kickWinBuildNumber(): void {
  if (winBuildKicked) return
  // Latch only once we know we're on Windows: before <html data-platform> is
  // stamped the platform reads '' and a latched flag would skip the fetch forever.
  if (currentPlatform() !== 'win32') return
  winBuildKicked = true
  void window.dockterm.invoke('app:getInfo', undefined).then((r) => {
    if (r.ok) winBuildNumber = r.value.windowsBuildNumber
  })
}

/**
 * A live terminal (xterm + PTY) that outlives the React component rendering it.
 *
 * The layout tree re-mounts a pane's React component whenever the tree is
 * restructured (splitting, building a grid, closing a sibling) — and a naive
 * terminal would spawn/kill its PTY on every such re-mount, destroying a running
 * Claude session. So the xterm instance lives in a module-level pool keyed by a
 * stable id and its DOM host is *detached/re-attached* across re-mounts instead
 * of being disposed. The PTY is only torn down when the pane is truly gone
 * (garbage-collected from the live layout) or when it's a non-persistent
 * (mini/preview) terminal that disposes on unmount.
 */
export interface PooledTerminal {
  id: string
  cwd?: string
  /** Persistent terminals survive React re-mounts and are torn down only by GC. */
  persist: boolean
  host: HTMLDivElement
  term: Terminal
  /** Latest per-render options (callbacks etc.); refreshed on each acquire. */
  opts: TerminalOptions
  attach: (container: HTMLElement) => void
  detach: () => void
  refit: () => void
  /** User-paste semantics (xterm paste). Not for app-sent input, see ptyInput.ts. */
  paste: (text: string) => void
  /** Raw PTY write, queued until the session exists. */
  write: (text: string) => void
  findNext: (q: string) => void
  findPrevious: (q: string) => void
  clearSearch: () => void
  focus: () => void
  /** Serialize the on-screen scrollback (for persistence across a full quit). */
  serialize: () => string
  /** Search the buffer for `text` and scroll to it (history navigation). */
  scrollToText: (text: string) => boolean
  dispose: () => void
}

/** Scroll a specific pane's terminal to the first match of `text` (best-effort). */
export function scrollPaneToText(leafId: string, text: string): boolean {
  return pool.get(leafId)?.scrollToText(text) ?? false
}

/** Put the keyboard back in a pane's terminal. Leaving chat mode doesn't change
 * `active` (the pane was focused all along), so TerminalView's focus effect never
 * re-runs — the caller nudges it here instead. No-op for an unpooled leaf. */
export function focusPaneTerminal(leafId: string): void {
  pool.get(leafId)?.focus()
}

/** Panes whose terminal is hidden behind chat view. Their xterm must never hold
 * the keyboard: keystrokes typed while the composer was busy would otherwise go
 * into Claude's own input box, invisibly. */
const chatHidden = new Set<string>()

/** Chat view opened (true) or closed (false) for a pane: blur the hidden xterm on
 * open, and let it take focus again on close. */
export function setPaneChatView(leafId: string, on: boolean): void {
  if (on) {
    chatHidden.add(leafId)
    pool.get(leafId)?.term.blur()
  } else chatHidden.delete(leafId)
}

/** Which screen buffer a pane is on. Claude Code's fullscreen TUI renders on the
 * `alternate` buffer (like vim/less) — there's no xterm scrollback to seek, and it
 * owns scrolling itself. A shell (or Claude's classic renderer) is on `normal`,
 * where the conversation lives in xterm's own searchable scrollback. */
export function paneBufferType(leafId: string): 'normal' | 'alternate' | null {
  return pool.get(leafId)?.term.buffer.active.type ?? null
}

/** Whether the pane's PTY currently expects bracketed-paste markers around
 * pasted text (set by full-screen apps like Claude Code, vim; a plain shell
 * usually leaves it off). `PooledTerminal.paste` handles this via xterm's own
 * `Terminal.paste`; callers that write raw (sendPrompt) use this to decide
 * whether to wrap the text themselves. */
export function paneBracketedPasteMode(leafId: string): boolean {
  return pool.get(leafId)?.term.modes.bracketedPasteMode ?? false
}

/** The text Claude currently has drawn on screen (the visible viewport rows). On
 * the alternate buffer this is the *only* readable content — what we poll while
 * driving Claude's scroll, to detect when a target prompt has come into view. */
export function paneVisibleText(leafId: string): string {
  const p = pool.get(leafId)
  if (!p) return ''
  const buf = p.term.buffer.active
  const start = buf.baseY
  const end = buf.baseY + p.term.rows
  let out = ''
  for (let y = start; y < end; y++) {
    out += (buf.getLine(y)?.translateToString(true) ?? '') + '\n'
  }
  return out
}

/** Distinctive recent lines from a pane's buffer — used to identify WHICH Claude
 * session this exact terminal is running (by matching the transcript). A fresh /
 * non-Claude terminal yields only chrome, which matches no transcript. */
export function getPaneSample(leafId: string, count = 40): string[] {
  const p = pool.get(leafId)
  if (!p) return []
  const buf = p.term.buffer.active
  const out: string[] = []
  for (let i = buf.length - 1; i >= 0 && out.length < count; i--) {
    const line = buf.getLine(i)?.translateToString(true).trim()
    // The main-process zod schema caps each sample line at 400 chars (app.ts):
    // an unclamped wide pane's line could exceed that and reject the whole
    // request silently. length is checked on the FULL line so distinctiveness
    // (the >=18 floor) isn't skewed by the cap.
    if (line && line.length >= 18) out.push(line.slice(0, 400))
  }
  return out
}

const pool = new Map<string, PooledTerminal>()
/** leafId → live pty session id, for the close-confirmation guard. */
const paneSessions = new Map<string, string>()

/** The pty session id backing a pane (null if not started / disposed). */
export function paneSessionId(leafId: string): string | null {
  return paneSessions.get(leafId) ?? null
}

/* ----------------------- scrollback persistence ------------------------- */
// Restore each terminal's prior scrollback (read-only) after a full quit. The
// processes are gone; only the picture comes back. Preloaded once before any
// terminal starts; applied (one-shot) just before the fresh PTY spawns.
const PERSIST_LINES = 1500
let persistEnabled = true
let preloadKicked = false
let restoredReady: Promise<void> = Promise.resolve()
const restored = new Map<string, string>()

export function setTerminalPersistence(enabled: boolean): void {
  persistEnabled = enabled
}

function kickPreload(): void {
  if (preloadKicked) return
  preloadKicked = true
  if (!persistEnabled) return
  restoredReady = window.dockterm
    .invoke('terminal:loadBuffers', undefined)
    .then((r) => {
      if (r.ok) for (const b of r.value) restored.set(b.leafId, b.data)
    })
    .catch(() => {})
}

/** Serialized scrollback of every live persistent terminal (for saving on quit). */
export function serializeAllPersistent(): { leafId: string; data: string }[] {
  if (!persistEnabled) return []
  const out: { leafId: string; data: string }[] = []
  for (const [id, p] of pool) {
    if (!p.persist) continue
    const data = p.serialize()
    if (data) out.push({ leafId: id, data })
  }
  return out
}

/**
 * Get the pooled terminal for `id`, creating it if needed. If a terminal exists
 * but its working directory changed (the pane was retargeted to a new folder),
 * the old one is disposed and a fresh shell is spawned in the new directory.
 */
export function acquireTerminal(id: string, opts: TerminalOptions): PooledTerminal {
  kickPreload()
  kickWinBuildNumber()
  const existing = pool.get(id)
  if (existing) {
    if (existing.cwd === opts.cwd) {
      existing.opts = opts
      return existing
    }
    disposeTerminal(id)
  }
  const created = createPooled(id, opts)
  pool.set(id, created)
  return created
}

/** Tear down and forget the pooled terminal for `id` (kills its PTY). */
export function disposeTerminal(id: string): void {
  const p = pool.get(id)
  if (!p) return
  pool.delete(id)
  p.dispose()
}

/**
 * Dispose every *persistent* pooled terminal whose id is no longer in the live
 * layout (the pane was closed or its tab/window went away). Non-persistent
 * (mini/preview) terminals manage their own lifetime via unmount.
 */
export function gcTerminals(liveIds: Set<string>): void {
  for (const [id, p] of [...pool.entries()]) {
    if (p.persist && !liveIds.has(id)) disposeTerminal(id)
  }
}

function createPooled(id: string, opts: TerminalOptions): PooledTerminal {
  const host = document.createElement('div')
  host.style.width = '100%'
  host.style.height = '100%'
  const platform = currentPlatform()

  const term = new Terminal({
    fontFamily: opts.fontFamily ?? DEFAULT_MONO,
    fontSize: opts.fontSize ?? 13,
    cursorStyle: opts.cursorStyle ?? 'block',
    cursorBlink: opts.cursorBlink ?? true,
    scrollback: opts.scrollback ?? 5000,
    allowProposedApi: true,
    // Off by default: on macOS, Option is how German/French/etc. layouts type
    // @{}[]|~\, and forcing it to always send Meta breaks that. Opt-in per the
    // terminal.macOptionIsMeta setting for anyone who actually wants Option as
    // a modifier (e.g. Emacs-style bindings).
    macOptionIsMeta: opts.macOptionIsMeta ?? false,
    // Compatibility heuristics for a pty hosted on Windows conpty (reflow +
    // how growing the viewport pulls rows back from scrollback); undefined on
    // other platforms, which is xterm's own "not Windows" default.
    windowsPty: platform === 'win32' ? { backend: 'conpty', buildNumber: bundledConptyBuild(winBuildNumber) } : undefined,
    // Conservatively rescale glyphs that would overlap the next cell — prevents
    // the "letters printed on letters" artifact under GPU acceleration.
    rescaleOverlappingGlyphs: true,
    theme: useThemeStore.getState().xterm,
    fontWeightBold: '600',
    // Instant, native-terminal scrolling: NO easing/animation (smoothScrollDuration
    // 0) so each wheel notch / trackpad delta lands immediately — exactly how the
    // macOS Terminal, gnome-terminal and konsole feel. A higher sensitivity covers
    // ground fast; Alt-scroll (fastScroll) multiplies further. An animated scroll
    // (smoothScrollDuration > 0) is what made it feel slow/"hard", so it's off.
    smoothScrollDuration: 0,
    scrollSensitivity: 4,
    fastScrollSensitivity: 8,
    // A touch more line height + a calm inactive cursor for comfort.
    cursorInactiveStyle: 'outline',
    lineHeight: opts.lineHeight ?? 1.15,
    letterSpacing: opts.letterSpacing ?? 0,
    // OSC 8 hyperlinks: without this, xterm falls back to a browser confirm()
    // dialog on every link click. Route through the same vetted path as
    // WebLinksAddon below (app:openExternal, which only allows http/https).
    linkHandler: {
      activate: (_event, text) => {
        if (/^https?:\/\//i.test(text)) void window.dockterm.invoke('app:openExternal', { url: text })
      }
    }
  })

  const fit = new FitAddon()
  const search = new SearchAddon()
  const serializer = new SerializeAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(serializer)
  // The default handler calls window.open() with no URL then sets .location:
  // Electron's window-open handling blocks/ignores that (blank popup, dead
  // click). Route through the main process instead, same as OSC 8 above.
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      void window.dockterm.invoke('app:openExternal', { url: uri })
    })
  )
  try {
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
  } catch {
    // proposed API unavailable
  }

  term.open(host)

  // Image paste (⌘V on macOS, where the DOM paste event carries the image): only
  // when the clipboard has no text. Claude-only, decided inside the handler.
  const imageDeps = (): ImagePasteDeps => ({
    saveImage: (data, mime) => window.dockterm.invoke('chat:saveImage', { data, mime }),
    readFiles: () => window.dockterm.invoke('clipboard:readFiles', undefined),
    saveClipboardImage: () => window.dockterm.invoke('clipboard:saveImage', undefined),
    // Lazy: paneClaudeActive imports this module.
    isClaude: () => import('./paneClaudeActive').then((m) => m.paneClaudeForeground(id)),
    paste: (text) => p.paste(text),
    platform: toComposerPlatform(platform),
    warn: (m) => useToastStore.getState().push(m, 'warning')
  })
  host.addEventListener('paste', (e) => void handleImagePasteEvent(e, imageDeps()), true)

  const p: PooledTerminal = {
    id,
    cwd: opts.cwd,
    persist: !!opts.persist,
    host,
    term,
    opts,
    // methods assigned below
    attach: () => {},
    detach: () => {},
    refit: () => {},
    paste: () => {},
    write: () => {},
    findNext: () => {},
    findPrevious: () => {},
    clearSearch: () => {},
    focus: () => {},
    serialize: () => '',
    scrollToText: () => false,
    dispose: () => {}
  }

  // Track the shell's working directory via OSC 7 (shell integration) so the dock
  // can follow `cd`. Returns true = handled.
  const osc7 = term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7(data, document.documentElement.dataset.platform ?? '')
    if (cwd) p.opts.onCwd?.(cwd)
    return true
  })

  // Track the terminal's title (OSC 0/2) so each pane can show its own label
  // (Claude Code sets this to a short task summary; shells often set the cwd).
  const titleSub = term.onTitleChange((title) => {
    if (title) p.opts.onTitle?.(title)
  })

  // Surface text selection so the pane can offer a "Send to Claude / Copy"
  // toolbar; auto-copy only when the user opted into copyOnSelect.
  const selSub = term.onSelectionChange(() => {
    const sel = term.getSelection()
    if (sel && p.opts.copyOnSelect) void navigator.clipboard.writeText(sel)
    p.opts.onSelection?.(sel)
  })

  // Make file paths in output clickable → open them in the editor.
  const pathLinks = term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const ln = term.buffer.active.getLine(bufferLineNumber - 1)
      if (!ln) return callback(undefined)
      const lineText = ln.translateToString(true)
      const found = findPathLinks(lineText)
      if (!found.length) return callback(undefined)
      // findPathLinks works on JS string offsets, but a wide character (CJK,
      // emoji) earlier on the line occupies TWO terminal columns for one
      // string char, so a plain string-index -> column mapping drifts the
      // click target off the actual text. Build the real cell sequence once
      // per line and translate through columnForStringIndex.
      const cells: CellSpan[] = []
      for (let x = 0; x < ln.length; x++) {
        const cell = ln.getCell(x)
        const width = cell?.getWidth() ?? 1
        if (width === 0) continue // second half of a wide char, no own column
        cells.push({ chars: cell?.getChars() || ' ', width })
      }
      callback(
        found.map((f) => {
          const startCol = columnForStringIndex(cells, f.index)
          const endCol = columnForStringIndex(cells, f.index + f.length)
          return {
            range: {
              start: { x: startCol + 1, y: bufferLineNumber },
              end: { x: endCol, y: bufferLineNumber }
            },
            text: f.path,
            activate: () => p.opts.onOpenPath?.(f.path, f.line),
            hover: (e: MouseEvent) => p.opts.onHoverPath?.(f.path, f.line, e.clientX, e.clientY),
            leave: () => p.opts.onLeavePath?.()
          }
        })
      )
    }
  })

  // Scroll/clipboard shortcuts (intercepted, not sent to the shell). Pure key
  // mapping lives in terminalKeys.ts; here we just perform the chosen action.
  // ⌘↓/⌘↑ jump to bottom/top; Shift+PageUp/Down page; on Linux/Windows
  // Ctrl+Shift+C/V copy the selection / paste the clipboard.
  term.attachCustomKeyEventHandler((e) => {
    const action = resolveTermKey(e, platform)
    if (!action) return true
    switch (action) {
      case 'scroll-bottom':
        term.scrollToBottom()
        return false
      case 'scroll-top':
        term.scrollToTop()
        return false
      case 'page-up':
        term.scrollPages(-1)
        return false
      case 'page-down':
        term.scrollPages(1)
        return false
      case 'copy': {
        const sel = term.getSelection()
        if (sel) void navigator.clipboard.writeText(sel)
        return false
      }
      case 'paste':
        // navigator.clipboard.readText() needs a permission grant, and the
        // app denies EVERY permission request outright (security.ts), so on
        // Windows/Linux (the only platforms this action fires on) that read
        // always failed silently, so Ctrl+Shift+V did nothing. Read via the
        // main process instead, which needs no renderer permission.
        e.preventDefault()
        void window.dockterm.invoke('clipboard:read', undefined).then((r) => {
          if (r.ok && r.value) p.paste(r.value)
          else if (r.ok) void pasteImageFromSystemClipboard(imageDeps())
        })
        return false
    }
    return true
  })

  // WebGL is loaded lazily on first attach (it needs the canvas in the DOM with
  // real dimensions); falls back to the DOM renderer if unavailable. On context
  // loss we dispose AND reload a fresh addon next frame, otherwise the renderer
  // stays degraded and prints garbled / overlapping glyphs.
  let webglTried = false
  let webglAddon: WebglAddon | null = null
  const loadWebgl = (): void => {
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => {
        webgl.dispose()
        if (webglAddon === webgl) webglAddon = null
        requestAnimationFrame(() => {
          if (host.clientWidth > 0 && host.clientHeight > 0) loadWebgl()
        })
      })
      term.loadAddon(webgl)
      webglAddon = webgl
    } catch {
      // WebGL unavailable -> DOM renderer
    }
  }
  const tryWebgl = (): void => {
    if (webglTried || (opts.renderer ?? 'auto') !== 'auto') return
    webglTried = true
    loadWebgl()
  }

  // Only fit when actually visible. A hidden/detached pane collapses to 0×0;
  // fitting then sends a bogus resize and garbles the shell's prompt.
  const safeFit = (): void => {
    if (host.clientWidth === 0 || host.clientHeight === 0) return
    try {
      fit.fit()
    } catch {
      // not laid out yet
    }
  }

  // Infer Claude's state from the rendered buffer (debounced), so the dock /
  // munu can react to working / asking / idle — even for hidden panes.
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  let statusMaxTimer: ReturnType<typeof setTimeout> | undefined
  const readBufferText = (): string => {
    const buf = term.buffer.active
    const start = Math.max(0, buf.baseY + term.rows - 60)
    const end = buf.baseY + term.rows
    let out = ''
    for (let y = start; y < end; y++) {
      out += (buf.getLine(y)?.translateToString(true) ?? '') + '\n'
    }
    return out
  }
  const holdStatus = createStatusHold()
  const fireStatus = (): void => {
    if (statusTimer) clearTimeout(statusTimer)
    if (statusMaxTimer) clearTimeout(statusMaxTimer)
    statusTimer = undefined
    statusMaxTimer = undefined
    const text = readBufferText()
    const { state, recheckIn } = holdStatus(classify(text), Date.now())
    // A held idle reading: look again once the hold is over, even if no bytes arrive.
    if (recheckIn !== undefined && !disposed) statusTimer = setTimeout(fireStatus, recheckIn)
    p.opts.onStatus?.(state, state === 'asking' ? parseAsk(text) : null)
  }
  // Debounce on a short quiet gap (so we read the *settled* menu, not a
  // half-drawn frame) but cap the total wait — Claude's spinner streams bytes
  // continuously while working, which a pure trailing debounce would let reset
  // forever, stalling the transition into 'asking'/'idle'. ~90ms quiet feels
  // instant; the 230ms ceiling guarantees the next prompt surfaces promptly.
  const QUIET_MS = 90
  const MAX_MS = 230
  const scheduleStatus = (): void => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(fireStatus, QUIET_MS)
    if (!statusMaxTimer) statusMaxTimer = setTimeout(fireStatus, MAX_MS)
  }

  let exited = false
  const pending: PtyDataEvent[] = []

  let sessionId: string | null = null
  const input = createPtyInput({
    sessionId: () => sessionId,
    send: (sid, data) => void window.dockterm.invoke('pty:write', { sessionId: sid, data }),
    termPaste: (text) => term.paste(text)
  })

  let hintTimer: ReturnType<typeof setTimeout> | undefined
  let hintShown = false
  const writeChunk = (data: string): void => {
    if (hintTimer) {
      clearTimeout(hintTimer)
      hintTimer = undefined
    }
    if (hintShown) {
      hintShown = false
      term.write(CLEAR_STARTING_HINT)
    }
    term.write(data, () => {
      if (sessionId) {
        void window.dockterm.invoke('pty:ack', {
          sessionId,
          bytes: encoder.encode(data).length
        })
      }
    })
  }

  const offData = window.dockterm.on('pty:data', (e) => {
    if (sessionId === null) {
      pending.push(e)
      return
    }
    if (e.sessionId === sessionId) {
      writeChunk(e.data)
      p.opts.onActivity?.()
      scheduleStatus()
    }
  })
  const offExit = window.dockterm.on('pty:exit', (e) => {
    if (e.sessionId === sessionId) {
      exited = true
      term.writeln(`\r\n\x1b[2m[shell exited with code ${e.exitCode}]\x1b[0m`)
    }
  })

  const dataSub = term.onData((d) => {
    if (sessionId && !exited) void window.dockterm.invoke('pty:write', { sessionId, data: d })
  })
  const resizeSub = term.onResize(({ cols, rows }) => {
    if (sessionId) void window.dockterm.invoke('pty:resize', { sessionId, cols, rows })
  })

  // Debounce so a multi-step layout change settles into a single resize.
  let fitTimer: ReturnType<typeof setTimeout> | undefined
  const observer = new ResizeObserver(() => {
    if (fitTimer) clearTimeout(fitTimer)
    fitTimer = setTimeout(() => safeFit(), 60)
  })
  observer.observe(host)

  // Create the PTY only AFTER the first fit, so it spawns at the correctly-sized
  // cols/rows. Spawning at the 80×24 default and resizing a frame later makes
  // Claude's full-screen TUI redraw at the wrong width → overlapping/garbled
  // output. One-shot: a detach/reattach never respawns the shell.
  let ptyStarted = false
  // True once p.dispose() has run. pty:create is an async round-trip started
  // from a callback that closes over this whole scope: if the pane is closed
  // (a real close, not detach/reattach) before it resolves, the .then below
  // must not resurrect the session's bookkeeping or leave the freshly-spawned
  // process running with nothing tracking it.
  let disposed = false
  const startPty = (): void => {
    if (ptyStarted) return
    ptyStarted = true
    // Capture the size actually requested: a resize that lands while this is
    // still in flight is dropped by resizeSub (it guards on sessionId, which
    // isn't set yet), so we diff against this once the session exists.
    const requestedCols = term.cols
    const requestedRows = term.rows
    void restoredReady
      .then(async () => {
        // Restore prior scrollback (read-only history) once, before the fresh
        // shell starts — the live process can't be resurrected.
        if (persistEnabled && opts.persist) {
          const saved = restored.get(id)
          if (saved) {
            restored.delete(id)
            term.write(saved)
            // Wait until xterm has parsed it, so the cursor row is known.
            await new Promise<void>((resolve) => term.write(RESTORE_BANNER, resolve))
            const tail = restoreScrollTail(currentPlatform(), term.rows, term.buffer.active.cursorY)
            if (tail) await new Promise<void>((resolve) => term.write(tail, resolve))
          }
        }
        if (currentPlatform() === 'win32') {
          hintTimer = setTimeout(() => {
            hintTimer = undefined
            if (disposed) return
            hintShown = true
            term.write(STARTING_HINT)
          }, STARTING_HINT_DELAY_MS)
        }
        return window.dockterm.invoke('pty:create', {
          kind: opts.kind,
          cols: requestedCols,
          rows: requestedRows,
          cwd: opts.cwd
        })
      })
      .then((res) => {
        if (!res.ok) {
          if (!disposed) term.writeln(`\x1b[31mFailed to start shell: ${res.error.message}\x1b[0m`)
          return
        }
        if (disposed) {
          // Torn down while the PTY was still spawning: kill the orphan the
          // pool no longer tracks instead of leaking it.
          void window.dockterm.invoke('pty:kill', { sessionId: res.value.sessionId })
          return
        }
        sessionId = res.value.sessionId
        paneSessions.set(id, res.value.sessionId)
        if (res.value.cwdFellBack) p.opts.onCwdFallback?.(res.value.cwd)
        // Catch up a resize that was dropped while spawning (see above).
        if (term.cols !== requestedCols || term.rows !== requestedRows) {
          void window.dockterm.invoke('pty:resize', { sessionId, cols: term.cols, rows: term.rows })
        }
        for (const e of pending) {
          if (e.sessionId === sessionId) writeChunk(e.data)
        }
        pending.length = 0
        input.flush()
        p.focus()
      })
  }

  p.attach = (container) => {
    container.appendChild(host)
    tryWebgl()
    requestAnimationFrame(() => {
      safeFit()
      startPty()
    })
  }
  p.detach = () => {
    if (host.parentElement) host.parentElement.removeChild(host)
  }
  p.refit = safeFit
  p.paste = input.paste
  p.write = input.write
  p.findNext = (q) => search.findNext(q)
  p.findPrevious = (q) => search.findPrevious(q)
  p.clearSearch = () => search.clearDecorations()
  p.focus = () => {
    if (!chatHidden.has(id)) term.focus()
  }
  p.serialize = () => {
    try {
      // The live process is what's running, not a picture of it: replaying a
      // saved alt-screen frame (Claude's fullscreen UI, vim, …) or terminal
      // modes (mouse tracking, bracketed paste) on restart just leaves xterm
      // in a mode with nothing left alive to drive it.
      return serializer.serialize({ scrollback: PERSIST_LINES, excludeAltBuffer: true, excludeModes: true })
    } catch {
      return ''
    }
  }
  p.scrollToText = (text) => {
    // Best-effort, SILENT: scroll the viewport to the prompt if it happens to be in
    // xterm's buffer. NOTE: when Claude is running it owns the screen (it pins its
    // input + manages scroll), so the conversation usually isn't in xterm's buffer
    // and this can't find it — the rail shows the full prompt text instead.
    const needle = text
      .replace(/\s+/g, ' ')
      .replace(/^\s*(\[Image #\d+\]\s*)+/i, '')
      .trim()
      .toLowerCase()
      .slice(0, 28)
    if (needle.length < 4) return false
    const buf = term.buffer.active
    for (let i = buf.length - 1; i >= 0; i--) {
      const line = buf.getLine(i)?.translateToString(true).toLowerCase()
      if (line && line.includes(needle)) {
        term.scrollToLine(Math.max(0, i - 3))
        return true
      }
    }
    return false
  }
  p.dispose = () => {
    disposed = true
    if (hintTimer) clearTimeout(hintTimer)
    offData()
    offExit()
    dataSub.dispose()
    resizeSub.dispose()
    observer.disconnect()
    osc7.dispose()
    titleSub.dispose()
    selSub.dispose()
    pathLinks.dispose()
    if (fitTimer) clearTimeout(fitTimer)
    if (statusTimer) clearTimeout(statusTimer)
    if (statusMaxTimer) clearTimeout(statusMaxTimer)
    if (sessionId) void window.dockterm.invoke('pty:kill', { sessionId })
    sessionId = null
    paneSessions.delete(id)
    term.dispose()
    if (host.parentElement) host.parentElement.removeChild(host)
    // Drop this pane's Claude-state + writer registrations (true close only).
    useMunuStore.getState().removePane(id)
    useComposeStore.getState().removePane(id)
    paneWriters.unregister(id)
  }

  return p
}
