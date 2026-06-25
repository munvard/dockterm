import { useEffect, useRef, type RefObject } from 'react'
import type { ClaudeState } from './claudeStatus'
import type { AskInfo } from '@shared/types'
import { useThemeStore } from '../../state/useThemeStore'
import { DEFAULT_MONO } from './terminalTheme'
import { acquireTerminal, disposeTerminal, type PooledTerminal } from './terminalPool'

export interface TerminalOptions {
  /** Stable identity for the pooled terminal — the pane's leaf id (or a mini id). */
  id: string
  kind: 'main' | 'mini'
  cwd?: string
  /**
   * Keep the terminal (xterm + PTY) alive across React re-mounts caused by layout
   * restructuring; it's only torn down when garbage-collected from the live
   * layout. Mini/preview terminals leave this false and dispose on unmount.
   */
  persist?: boolean
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
  /** The terminal's live title from OSC 0/2 (what Claude Code / the shell sets). */
  onTitle?: (title: string) => void
  /** Reports the pane's inferred Claude state from the rendered buffer. */
  onStatus?: (state: ClaudeState, ask: AskInfo | null) => void
  /** Open a file path clicked in the terminal output (with optional 1-based line). */
  onOpenPath?: (path: string, line: number | null) => void
  /** The selected text changed (empty string when cleared). */
  onSelection?: (sel: string) => void
  /** Copy to the clipboard automatically when text is selected. */
  copyOnSelect?: boolean
}

export interface TerminalHandle {
  containerRef: RefObject<HTMLDivElement | null>
  findNext: (query: string) => void
  findPrevious: (query: string) => void
  clearSearch: () => void
  focus: () => void
  /** Write text into the PTY (queued until the session is ready). No newline added. */
  paste: (text: string) => void
  /** The terminal's current selected text ('' if none). */
  getSelection: () => string
}

export function useTerminal(options: TerminalOptions): TerminalHandle {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const poolRef = useRef<PooledTerminal | null>(null)
  const optsRef = useRef(options)
  optsRef.current = options
  const xtermTheme = useThemeStore((s) => s.xterm)

  // Keep the pooled terminal's callbacks/options fresh on every render so it
  // always reports to the current component (tab id, handlers, etc.).
  if (poolRef.current) poolRef.current.opts = options

  // Acquire (or create) the pooled terminal for this id and attach its DOM into
  // our container. On unmount we DETACH (not dispose) for persistent terminals,
  // so a layout re-mount keeps the running shell; non-persistent terminals
  // dispose. `id`/`cwd` in the dep array re-acquire when the pane is retargeted.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const p = acquireTerminal(optsRef.current.id, optsRef.current)
    poolRef.current = p
    p.attach(container)
    return () => {
      p.detach()
      if (!optsRef.current.persist) disposeTerminal(p.id)
      poolRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.id, options.cwd])

  // Live-update font/cursor options.
  useEffect(() => {
    const term = poolRef.current?.term
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
    const p = poolRef.current
    if (!p) return
    const raf = requestAnimationFrame(() => {
      p.refit()
      p.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [options.active])

  // Live-update the terminal palette when the theme changes.
  useEffect(() => {
    if (poolRef.current) poolRef.current.term.options.theme = xtermTheme
  }, [xtermTheme])

  return {
    containerRef,
    findNext: (q) => poolRef.current?.findNext(q),
    findPrevious: (q) => poolRef.current?.findPrevious(q),
    clearSearch: () => poolRef.current?.clearSearch(),
    focus: () => poolRef.current?.focus(),
    paste: (text) => poolRef.current?.paste(text),
    getSelection: () => poolRef.current?.term.getSelection() ?? ''
  }
}
