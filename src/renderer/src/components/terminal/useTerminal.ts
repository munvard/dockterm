import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtyDataEvent } from '@shared/ipc'
import { DEFAULT_MONO } from './terminalTheme'
import { parseOsc7 } from './osc7'
import { classify, parseAsk, type ClaudeState } from './claudeStatus'
import { useThemeStore } from '../../state/useThemeStore'
import '@xterm/xterm/css/xterm.css'

const encoder = new TextEncoder()

export interface TerminalOptions {
  kind: 'main' | 'mini'
  cwd?: string
  fontFamily?: string
  fontSize?: number
  cursorStyle?: 'block' | 'underline' | 'bar'
  cursorBlink?: boolean
  scrollback?: number
  renderer?: 'auto' | 'dom'
  /** True when this terminal's tab is the visible/active one. */
  active?: boolean
  /** Called when output arrives (used to flag background-tab activity). */
  onActivity?: () => void
  /** Called with the shell's live working directory (from OSC 7), when reported. */
  onCwd?: (cwd: string) => void
  /** Reports the pane's inferred Claude state from the rendered buffer. */
  onStatus?: (state: ClaudeState, ask: string | null) => void
}

export interface TerminalHandle {
  containerRef: RefObject<HTMLDivElement | null>
  findNext: (query: string) => void
  findPrevious: (query: string) => void
  clearSearch: () => void
  focus: () => void
  /** Write text into the PTY (queued until the session is ready). No newline added. */
  paste: (text: string) => void
}

export function useTerminal(options: TerminalOptions): TerminalHandle {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pasteQueueRef = useRef('')
  const optsRef = useRef(options)
  optsRef.current = options
  const xtermTheme = useThemeStore((s) => s.xterm)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const o = optsRef.current

    const term = new Terminal({
      fontFamily: o.fontFamily ?? DEFAULT_MONO,
      fontSize: o.fontSize ?? 13,
      cursorStyle: o.cursorStyle ?? 'block',
      cursorBlink: o.cursorBlink ?? true,
      scrollback: o.scrollback ?? 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: useThemeStore.getState().xterm,
      fontWeightBold: '600'
    })
    termRef.current = term

    const fit = new FitAddon()
    fitRef.current = fit
    const search = new SearchAddon()
    searchRef.current = search
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon())
    try {
      const unicode = new Unicode11Addon()
      term.loadAddon(unicode)
      term.unicode.activeVersion = '11'
    } catch {
      // proposed API unavailable
    }

    term.open(container)

    // Track the shell's working directory via OSC 7 (emitted by shell integration)
    // so the dock can follow `cd`. Returns true = handled.
    const osc7 = term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7(data)
      if (cwd) optsRef.current.onCwd?.(cwd)
      return true
    })

    // Scroll shortcuts (intercepted, not sent to the shell). ⌘↓/⌘↑ jump to
    // bottom/top; Shift+PageUp/Down page. Typing already returns to the bottom
    // via xterm's scrollOnUserInput, and drag-selection auto-scrolls natively.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if (e.metaKey && e.key === 'ArrowDown') {
        term.scrollToBottom()
        return false
      }
      if (e.metaKey && e.key === 'ArrowUp') {
        term.scrollToTop()
        return false
      }
      if (e.shiftKey && e.key === 'PageUp') {
        term.scrollPages(-1)
        return false
      }
      if (e.shiftKey && e.key === 'PageDown') {
        term.scrollPages(1)
        return false
      }
      return true
    })

    if ((o.renderer ?? 'auto') === 'auto') {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        // WebGL unavailable -> DOM renderer
      }
    }

    // Only fit when the terminal is actually visible. A hidden pane/tab collapses
    // to 0×0; fitting then would send a bogus resize and make the shell redraw its
    // prompt at the wrong width (leaving garbled prompt fragments on return).
    const safeFit = (): void => {
      const c = containerRef.current
      if (!c || c.clientWidth === 0 || c.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // not laid out yet
      }
    }

    safeFit()

    // Infer Claude's state from the rendered buffer (debounced), so the dock /
    // munu can react to working / asking / idle — even for hidden panes.
    let statusTimer: ReturnType<typeof setTimeout> | undefined
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
    const scheduleStatus = (): void => {
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => {
        const text = readBufferText()
        const state = classify(text)
        optsRef.current.onStatus?.(state, state === 'asking' ? parseAsk(text) : null)
      }, 200)
    }

    let exited = false
    const pending: PtyDataEvent[] = []

    const writeChunk = (data: string): void => {
      term.write(data, () => {
        const id = sessionIdRef.current
        if (id) {
          void window.dockterm.invoke('pty:ack', { sessionId: id, bytes: encoder.encode(data).length })
        }
      })
    }

    const offData = window.dockterm.on('pty:data', (e) => {
      if (sessionIdRef.current === null) {
        pending.push(e)
        return
      }
      if (e.sessionId === sessionIdRef.current) {
        writeChunk(e.data)
        optsRef.current.onActivity?.()
        scheduleStatus()
      }
    })
    const offExit = window.dockterm.on('pty:exit', (e) => {
      if (e.sessionId === sessionIdRef.current) {
        exited = true
        term.writeln(`\r\n\x1b[2m[shell exited with code ${e.exitCode}]\x1b[0m`)
      }
    })

    const dataSub = term.onData((d) => {
      const id = sessionIdRef.current
      if (id && !exited) void window.dockterm.invoke('pty:write', { sessionId: id, data: d })
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      const id = sessionIdRef.current
      if (id) void window.dockterm.invoke('pty:resize', { sessionId: id, cols, rows })
    })

    // Debounce so a multi-step layout change (splitting, building a grid,
    // dragging a divider) settles into a single resize — repeated fits make the
    // shell redraw its prompt over and over, leaving fragments.
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (fitTimer) clearTimeout(fitTimer)
      fitTimer = setTimeout(() => safeFit(), 60)
    })
    observer.observe(container)

    void window.dockterm
      .invoke('pty:create', { kind: o.kind, cols: term.cols, rows: term.rows, cwd: o.cwd })
      .then((res) => {
        if (!res.ok) {
          term.writeln(`\x1b[31mFailed to start shell: ${res.error.message}\x1b[0m`)
          return
        }
        sessionIdRef.current = res.value.sessionId
        for (const e of pending) {
          if (e.sessionId === sessionIdRef.current) writeChunk(e.data)
        }
        pending.length = 0
        if (pasteQueueRef.current) {
          void window.dockterm.invoke('pty:write', {
            sessionId: sessionIdRef.current,
            data: pasteQueueRef.current
          })
          pasteQueueRef.current = ''
        }
        term.focus()
      })

    return () => {
      offData()
      offExit()
      dataSub.dispose()
      resizeSub.dispose()
      observer.disconnect()
      osc7.dispose()
      if (fitTimer) clearTimeout(fitTimer)
      if (statusTimer) clearTimeout(statusTimer)
      if (sessionIdRef.current) void window.dockterm.invoke('pty:kill', { sessionId: sessionIdRef.current })
      sessionIdRef.current = null
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = options.fontSize ?? 13
    term.options.fontFamily = options.fontFamily ?? DEFAULT_MONO
    term.options.cursorStyle = options.cursorStyle ?? 'block'
    term.options.cursorBlink = options.cursorBlink ?? true
  }, [options.fontSize, options.fontFamily, options.cursorStyle, options.cursorBlink])

  // When this terminal's tab becomes active, refit (it may have been hidden at
  // 0×0) and focus it.
  useEffect(() => {
    if (!options.active) return
    const term = termRef.current
    if (!term) return
    const raf = requestAnimationFrame(() => {
      const c = containerRef.current
      if (c && c.clientWidth > 0 && c.clientHeight > 0) {
        try {
          fitRef.current?.fit()
        } catch {
          // not laid out yet
        }
      }
      term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [options.active])

  // Live-update the terminal palette when the theme changes.
  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = xtermTheme
  }, [xtermTheme])

  return {
    containerRef,
    findNext: (q) => {
      searchRef.current?.findNext(q)
    },
    findPrevious: (q) => {
      searchRef.current?.findPrevious(q)
    },
    clearSearch: () => {
      searchRef.current?.clearDecorations()
    },
    focus: () => {
      termRef.current?.focus()
    },
    paste: (text) => {
      const id = sessionIdRef.current
      if (id) void window.dockterm.invoke('pty:write', { sessionId: id, data: text })
      else pasteQueueRef.current += text
    }
  }
}
