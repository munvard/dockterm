import { useEffect, useRef, type RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtyDataEvent } from '@shared/ipc'
import { terminalTheme, DEFAULT_MONO } from './terminalTheme'
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
  /** 'auto' tries WebGL then falls back to the DOM renderer; 'dom' forces DOM. */
  renderer?: 'auto' | 'dom'
}

export interface TerminalHandle {
  containerRef: RefObject<HTMLDivElement | null>
  findNext: (query: string) => void
  findPrevious: (query: string) => void
  clearSearch: () => void
  focus: () => void
}

/**
 * Owns one xterm.js instance bound to one PTY session in the main process.
 *
 * Output path: `pty:data` -> term.write(data, ack) -> `pty:ack` (drives the
 * main-process watermark flow control). Input path: term.onData -> `pty:write`.
 * Initial shell output that arrives before `pty:create` resolves is buffered and
 * replayed so the first prompt is never lost.
 */
export function useTerminal(options: TerminalOptions): TerminalHandle {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const optsRef = useRef(options)
  optsRef.current = options

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
      theme: terminalTheme,
      fontWeightBold: '600'
    })
    termRef.current = term

    const fit = new FitAddon()
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
      // proposed API unavailable; default unicode handling is fine
    }

    term.open(container)

    if ((o.renderer ?? 'auto') === 'auto') {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        // WebGL unavailable (e.g. lost context, headless) -> DOM renderer stays
      }
    }

    try {
      fit.fit()
    } catch {
      // container not laid out yet
    }

    let sessionId: string | null = null
    let exited = false
    const pending: PtyDataEvent[] = []

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
      if (e.sessionId === sessionId) writeChunk(e.data)
    })
    const offExit = window.dockterm.on('pty:exit', (e) => {
      if (e.sessionId === sessionId) {
        exited = true
        term.writeln(`\r\n\x1b[2m[shell exited with code ${e.exitCode}]\x1b[0m`)
      }
    })

    const dataSub = term.onData((d) => {
      if (sessionId && !exited) {
        void window.dockterm.invoke('pty:write', { sessionId, data: d })
      }
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (sessionId) void window.dockterm.invoke('pty:resize', { sessionId, cols, rows })
    })

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // hidden / zero-size container
      }
    })
    observer.observe(container)

    void window.dockterm
      .invoke('pty:create', { kind: o.kind, cols: term.cols, rows: term.rows, cwd: o.cwd })
      .then((res) => {
        if (!res.ok) {
          term.writeln(`\x1b[31mFailed to start shell: ${res.error.message}\x1b[0m`)
          return
        }
        sessionId = res.value.sessionId
        for (const e of pending) {
          if (e.sessionId === sessionId) writeChunk(e.data)
        }
        pending.length = 0
        term.focus()
      })

    return () => {
      offData()
      offExit()
      dataSub.dispose()
      resizeSub.dispose()
      observer.disconnect()
      if (sessionId) void window.dockterm.invoke('pty:kill', { sessionId })
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
    }
  }
}
