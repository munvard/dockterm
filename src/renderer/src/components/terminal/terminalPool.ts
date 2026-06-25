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
import { findPathLinks } from './pathLinks'
import { useThemeStore } from '../../state/useThemeStore'
import { useMunuStore } from '../../state/useMunuStore'
import { paneWriters } from '../../state/paneWriters'
import type { TerminalOptions } from './useTerminal'
import '@xterm/xterm/css/xterm.css'

const encoder = new TextEncoder()

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
  paste: (text: string) => void
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

/** Which screen buffer a pane is on. Claude Code's fullscreen TUI renders on the
 * `alternate` buffer (like vim/less) — there's no xterm scrollback to seek, and it
 * owns scrolling itself. A shell (or Claude's classic renderer) is on `normal`,
 * where the conversation lives in xterm's own searchable scrollback. */
export function paneBufferType(leafId: string): 'normal' | 'alternate' | null {
  return pool.get(leafId)?.term.buffer.active.type ?? null
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
    if (line && line.length >= 18) out.push(line)
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

  const term = new Terminal({
    fontFamily: opts.fontFamily ?? DEFAULT_MONO,
    fontSize: opts.fontSize ?? 13,
    cursorStyle: opts.cursorStyle ?? 'block',
    cursorBlink: opts.cursorBlink ?? true,
    scrollback: opts.scrollback ?? 5000,
    allowProposedApi: true,
    macOptionIsMeta: true,
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
    lineHeight: 1.15
  })

  const fit = new FitAddon()
  const search = new SearchAddon()
  const serializer = new SerializeAddon()
  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(serializer)
  term.loadAddon(new WebLinksAddon())
  try {
    const unicode = new Unicode11Addon()
    term.loadAddon(unicode)
    term.unicode.activeVersion = '11'
  } catch {
    // proposed API unavailable
  }

  term.open(host)

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
    const cwd = parseOsc7(data)
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
      const found = findPathLinks(ln.translateToString(true))
      if (!found.length) return callback(undefined)
      callback(
        found.map((f) => ({
          range: {
            start: { x: f.index + 1, y: bufferLineNumber },
            end: { x: f.index + f.length, y: bufferLineNumber }
          },
          text: f.path,
          activate: () => p.opts.onOpenPath?.(f.path, f.line),
          hover: (e: MouseEvent) => p.opts.onHoverPath?.(f.path, f.line, e.clientX, e.clientY),
          leave: () => p.opts.onLeavePath?.()
        }))
      )
    }
  })

  // Scroll/clipboard shortcuts (intercepted, not sent to the shell). Pure key
  // mapping lives in terminalKeys.ts; here we just perform the chosen action.
  // ⌘↓/⌘↑ jump to bottom/top; Shift+PageUp/Down page; on Linux/Windows
  // Ctrl+Shift+C/V copy the selection / paste the clipboard.
  const platform = document.documentElement.dataset.platform ?? ''
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
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) p.paste(text)
          })
          .catch(() => {
            // clipboard read denied / empty — nothing to paste
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
  const fireStatus = (): void => {
    if (statusTimer) clearTimeout(statusTimer)
    if (statusMaxTimer) clearTimeout(statusMaxTimer)
    statusTimer = undefined
    statusMaxTimer = undefined
    const text = readBufferText()
    const state = classify(text)
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
  let pasteQueue = ''

  const writeChunk = (data: string): void => {
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
  const startPty = (): void => {
    if (ptyStarted) return
    ptyStarted = true
    void restoredReady
      .then(() => {
        // Restore prior scrollback (read-only history) once, before the fresh
        // shell starts — the live process can't be resurrected.
        if (persistEnabled && opts.persist) {
          const saved = restored.get(id)
          if (saved) {
            restored.delete(id)
            term.write(saved)
            term.write(
              '\r\n\x1b[90m──── session restored · processes are not (run claude --resume to continue) ────\x1b[0m\r\n'
            )
          }
        }
        return window.dockterm.invoke('pty:create', {
          kind: opts.kind,
          cols: term.cols,
          rows: term.rows,
          cwd: opts.cwd
        })
      })
      .then((res) => {
        if (!res.ok) {
          term.writeln(`\x1b[31mFailed to start shell: ${res.error.message}\x1b[0m`)
          return
        }
        sessionId = res.value.sessionId
        paneSessions.set(id, res.value.sessionId)
        for (const e of pending) {
          if (e.sessionId === sessionId) writeChunk(e.data)
        }
        pending.length = 0
        if (pasteQueue) {
          void window.dockterm.invoke('pty:write', { sessionId, data: pasteQueue })
          pasteQueue = ''
        }
        term.focus()
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
  p.paste = (text) => {
    if (sessionId) void window.dockterm.invoke('pty:write', { sessionId, data: text })
    else pasteQueue += text
  }
  p.findNext = (q) => search.findNext(q)
  p.findPrevious = (q) => search.findPrevious(q)
  p.clearSearch = () => search.clearDecorations()
  p.focus = () => term.focus()
  p.serialize = () => {
    try {
      return serializer.serialize({ scrollback: PERSIST_LINES })
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
    paneWriters.unregister(id)
  }

  return p
}
