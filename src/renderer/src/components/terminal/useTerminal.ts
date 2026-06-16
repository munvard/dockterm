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
  renderer?: 'auto' | 'dom'
  /** True when this terminal's tab is the visible/active one. */
  active?: boolean
  /** Called when output arrives (used to flag background-tab activity). */
  onActivity?: () => void
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

    if ((o.renderer ?? 'auto') === 'auto') {
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => webgl.dispose())
        term.loadAddon(webgl)
      } catch {
        // WebGL unavailable -> DOM renderer
      }
    }

    try {
      fit.fit()
    } catch {
      // not laid out yet
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

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // hidden container
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
      try {
        fitRef.current?.fit()
      } catch {
        // not laid out yet
      }
      term.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [options.active])

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
