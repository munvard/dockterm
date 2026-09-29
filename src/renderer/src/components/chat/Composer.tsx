import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, Maximize2, Mic, Paperclip, Square } from 'lucide-react'
import type { TreeNode } from '@shared/ipc'
import type { SkillsReadResult } from '@shared/types'
import { paneWriters } from '../../state/paneWriters'
import { useComposeStore } from '../../state/useComposeStore'
import { useReadingStore } from '../../state/useReadingStore'
import { useToastStore } from '../../state/useToastStore'
import { sendComposed } from '../../state/sendComposed'
import { k, PASTE_PLAIN_EVENT } from '../../hooks/keys'
import { opensPicker, ESC } from '../terminal/askKeys'
import { AttachmentTray } from './AttachmentTray'
import { ComposerMenu, ComposerMenuNote, type MenuItem } from './ComposerMenu'
import {
  attachClipboardFiles,
  attachImageFile,
  attachPaths,
  leafRoot,
  pickAndAttach
} from './composerActions'
import { isLargePaste, pasteText } from './composerPaste'
import { expandPasted, liveChips, pastedToken, type Attachment, type PastedChip } from './composerText'
import {
  applyCompletion,
  detectTrigger,
  isComposingKey,
  mergeCommands,
  rankFuzzy
} from './composerTriggers'
import { voiceInsertion } from './claudeVoice'
import { createMicGesture } from './micGesture'
import { useClaudeVoice } from './useClaudeVoice'
import { VoiceStrip } from './VoiceStrip'
import { IDLE_NAV, mergeHistory, shouldRecall, stepHistory, type HistoryNav } from './promptHistory'

const EMPTY_ATTACHMENTS: Attachment[] = []
const EMPTY_CHIPS: PastedChip[] = []
const EMPTY_HISTORY: string[] = []
const MAX_HEIGHT_RATIO = 0.45
const MIN_MAX_HEIGHT = 72

type Extras = { slashName: string; description: string; source: 'skill' | 'command' }[]

function skillExtras(r: SkillsReadResult): Extras {
  return [
    ...r.skills.map((s) => ({ slashName: s.slashName, description: s.description, source: 'skill' as const })),
    ...r.commands.map((c) => ({ slashName: c.slashName, description: c.description, source: 'command' as const }))
  ]
}

/**
 * The prompt box for chat mode. Sends through the SAME bracketed-paste path the
 * Compose overlay uses, so multi-line prompts land in Claude's input intact.
 * Slash commands that open Claude's own picker hand the pane back to the terminal.
 *
 * Draft, attachments, pasted-text chips and history live in useComposeStore per
 * pane, so they survive the chat/terminal toggle and are shared with the big editor.
 */
export function Composer({
  leafId,
  disabled,
  noClaude = false,
  onSentPicker
}: {
  leafId: string
  disabled: boolean
  /** Claude isn't running in this pane — the pty would run the text as a SHELL
   * command, so input is off and the placeholder says so. */
  noClaude?: boolean
  onSentPicker: () => void
}): React.ReactElement {
  const text = useComposeStore((s) => s.drafts[leafId] ?? '')
  const attachments = useComposeStore((s) => s.attachments[leafId] ?? EMPTY_ATTACHMENTS)
  const allChips = useComposeStore((s) => s.chips[leafId] ?? EMPTY_CHIPS)
  const history = useComposeStore((s) => s.history[leafId] ?? EMPTY_HISTORY)
  const chips = useMemo(() => liveChips(text, allChips), [text, allChips])

  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingCaret = useRef<number | null>(null)
  const navRef = useRef<HistoryNav>(IDLE_NAV)
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)
  const [extras, setExtras] = useState<Extras>([])
  const [fileHits, setFileHits] = useState<TreeNode[]>([])
  const spaceHeld = useRef(false)
  const gesture = useRef(createMicGesture()).current

  const setText = useCallback(
    (t: string) => useComposeStore.getState().setDraftFor(leafId, t),
    [leafId]
  )

  // Chat mode mounts this fresh every time it opens, so mount-focus is exactly
  // "⌘R put the caret somewhere useful".
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [])

  // Skills and commands for the `/` menu (read once per mount).
  useEffect(() => {
    let stop = false
    void window.dockterm.invoke('claude:skillsRead', { includeUser: true }).then((r) => {
      if (!stop && r.ok) setExtras(skillExtras(r.value))
    })
    return () => {
      stop = true
    }
  }, [])

  // Auto-grow up to ~45% of the pane, then scroll.
  const grow = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    const pane = ta.closest('.panechat')
    const max = Math.max(MIN_MAX_HEIGHT, (pane?.clientHeight ?? 600) * MAX_HEIGHT_RATIO)
    const want = ta.scrollHeight + 2
    ta.style.height = `${Math.min(want, max)}px`
    ta.style.overflowY = want > max ? 'auto' : 'hidden'
  }, [])
  useLayoutEffect(grow, [text, grow])
  useEffect(() => {
    window.addEventListener('resize', grow)
    return () => window.removeEventListener('resize', grow)
  }, [grow])

  // Caret requested by a programmatic edit (menu pick, history recall).
  useLayoutEffect(() => {
    const c = pendingCaret.current
    const ta = taRef.current
    if (c === null || !ta) return
    pendingCaret.current = null
    ta.setSelectionRange(c, c)
    setCaret(c)
  }, [text])

  const trigger = !disabled ? detectTrigger(text, caret) : null
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}` : null
  const active = trigger && dismissed !== triggerKey ? trigger : null
  const activeKind = active?.kind ?? null
  const activeQuery = active?.query ?? ''

  // `@` file search over the project root (debounced, latest request wins).
  useEffect(() => {
    if (activeKind !== 'at' || !activeQuery) {
      setFileHits([])
      return
    }
    let stop = false
    const t = setTimeout(() => {
      void window.dockterm.invoke('fs:search', { query: activeQuery }).then((r) => {
        if (stop) return
        setFileHits(r.ok ? rankFuzzy(r.value, activeQuery, (n) => n.relPath, 30) : [])
      })
    }, 120)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [activeKind, activeQuery])

  useEffect(() => setMenuIndex(0), [activeKind, activeQuery])

  const menu = useMemo(() => {
    const items: (MenuItem & { insert: string })[] = []
    if (activeKind === 'slash') {
      for (const c of rankFuzzy(mergeCommands(extras), `/${activeQuery}`, (c) => c.name, 30)) {
        items.push({
          key: c.name,
          label: c.name,
          hint: c.description,
          badge: c.source === 'built-in' ? undefined : c.source,
          insert: `${c.name} `
        })
      }
    } else if (activeKind === 'at') {
      for (const n of fileHits) {
        const ref = /\s/.test(n.relPath) ? `@"${n.relPath}"` : `@${n.relPath}`
        items.push({
          key: n.relPath,
          label: n.relPath,
          badge: n.type === 'dir' ? 'folder' : undefined,
          insert: `${ref} `
        })
      }
    }
    return items
  }, [activeKind, activeQuery, extras, fileHits])

  const menuOpen = menu.length > 0
  const pick = (i: number): void => {
    const it = menu[i]
    if (!it || !active) return
    const r = applyCompletion(text, active, it.insert)
    pendingCaret.current = r.caret
    setDismissed(null)
    setText(r.value)
    taRef.current?.focus()
  }

  // Insert at the selection with execCommand so the browser's undo stack keeps working.
  const insertAtSelection = useCallback(
    (s: string) => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      if (!document.execCommand('insertText', false, s)) {
        const at = ta.selectionStart
        const value = ta.value.slice(0, at) + s + ta.value.slice(ta.selectionEnd)
        pendingCaret.current = at + s.length
        setText(value)
      }
    },
    [setText]
  )

  const insertPasted = useCallback(
    (t: string) => {
      if (!t) return
      if (isLargePaste(t)) {
        const chip = useComposeStore.getState().addChip(leafId, t)
        insertAtSelection(pastedToken(chip.id))
      } else insertAtSelection(t)
    },
    [leafId, insertAtSelection]
  )

  // Speech to text through Claude's own voice mode: the transcript lands at the caret.
  const voice = useClaudeVoice(leafId, (t) => {
    const ta = taRef.current
    const s = ta
      ? voiceInsertion(ta.value, ta.selectionStart, ta.selectionEnd, t)
      : voiceInsertion('', 0, 0, t)
    if (s) insertAtSelection(s)
  })
  const voiceOn = voice.snapshot.phase !== 'idle'
  const micDisabled = disabled || noClaude

  // "Paste as plain text" (⌘⇧V / Ctrl+Shift+V) arrives from the shortcut registry.
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const onPlain = (): void => {
      void window.dockterm.invoke('clipboard:read', undefined).then((r) => {
        if (r.ok && r.value) insertPasted(pasteText({ text: r.value, html: '', types: [] }, true))
      })
    }
    ta.addEventListener(PASTE_PLAIN_EVENT, onPlain)
    return () => ta.removeEventListener(PASTE_PLAIN_EVENT, onPlain)
  }, [insertPasted])

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const dt = e.clipboardData
    const raw = dt.getData('text/plain')
    const payload = { text: raw, html: dt.getData('text/html'), types: Array.from(dt.types) }
    const files = Array.from(dt.files)
    if (files.length === 0) {
      const converted = pasteText(payload)
      // Ordinary text: let the textarea paste it natively (keeps undo, IME, spellcheck).
      if (converted === raw.replace(/\r\n?/g, '\n') && !isLargePaste(converted)) return
      e.preventDefault()
      insertPasted(converted)
      return
    }
    // Files or an image are on the clipboard. Finder / Explorer copies must be
    // read from the OS (Chromium hands over the file ICON as an image).
    e.preventDefault()
    void (async () => {
      if ((await attachClipboardFiles(leafId)) > 0) return
      if (raw) return insertPasted(pasteText(payload))
      for (const f of files) {
        if (await attachImageFile(leafId, f)) continue
        const p = window.dockterm.pathForFile(f)
        if (p) await attachPaths(leafId, [p])
      }
    })()
  }

  const send = async (): Promise<void> => {
    if (sendingRef.current || disabled) return
    if (!text.trim() && attachments.length === 0) return
    const live = liveChips(text, allChips)
    sendingRef.current = true
    setSending(true)
    try {
      const ok = await sendComposed(leafId, { text, chips: live, attachments, root: leafRoot(leafId) })
      if (!ok) {
        useToastStore.getState().push('Could not send. Is Claude still running in this pane?', 'warning')
        return
      }
      const store = useComposeStore.getState()
      store.recordHistory(leafId, expandPasted(text, live).trim())
      store.clearComposer(leafId)
      navRef.current = IDLE_NAV
      if (opensPicker(text)) onSentPicker()
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const transcriptPrompts = (): string[] =>
    (useReadingStore.getState().byLeaf[leafId]?.messages ?? [])
      .filter((m) => m.role === 'user' && m.text)
      .map((m) => m.text as string)

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // An IME owns Enter / Esc / arrows while it composes.
    if (isComposingKey({ isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) return

    // Esc while recording cancels it (Claude's recording too) instead of interrupting Claude.
    if (e.key === 'Escape' && voice.isActive()) {
      e.preventDefault()
      e.stopPropagation()
      spaceHeld.current = false
      voice.cancel()
      return
    }
    // Holding Space in an EMPTY composer is push-to-talk. The first press still types
    // a space (a single tap stays a space); the auto-repeat is what starts recording.
    if (e.key === ' ' && e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (spaceHeld.current) {
        e.preventDefault()
        return
      }
      if (!micDisabled && !voice.isActive() && text.trim() === '' && attachments.length === 0) {
        e.preventDefault()
        spaceHeld.current = true
        if (text !== '') setText('')
        void voice.start()
        return
      }
    }

    if (menuOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = menu.length
        setMenuIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n))
        return
      }
      const exact = activeKind === 'slash' && menu[menuIndex]?.label === `/${activeQuery}`
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !exact)) {
        e.preventDefault()
        pick(menuIndex)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissed(triggerKey)
        return
      }
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      const dir = e.key === 'ArrowUp' ? 'up' : 'down'
      const ta = e.currentTarget
      if (shouldRecall(dir, ta.value, ta.selectionStart, ta.selectionEnd, navRef.current)) {
        const list = mergeHistory(transcriptPrompts(), history)
        const r = stepHistory(list, navRef.current, dir, ta.value)
        if (r.text !== null) {
          e.preventDefault()
          navRef.current = r.nav
          pendingCaret.current = r.text.length
          setText(r.text)
          return
        }
      }
    }

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault()
      useComposeStore.getState().openCompose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      paneWriters.write(leafId, ESC) // interrupt Claude
    }
  }

  const canSend = !disabled && !sending && (text.trim().length > 0 || attachments.length > 0)

  return (
    <div className="composer">
      <VoiceStrip
        snapshot={voice.snapshot}
        onEnable={voice.enableVoice}
        onDismissHint={voice.dismissHint}
        canEnable={voice.canEnableVoice}
      />
      <AttachmentTray leafId={leafId} attachments={attachments} chips={chips} />
      <div className="composer__row">
        <div className="composer__field">
          {menuOpen && (
            <ComposerMenu items={menu} index={menuIndex} onPick={pick} onHover={setMenuIndex} />
          )}
          {!menuOpen && active?.kind === 'at' && (
            <ComposerMenuNote>
              {active.query ? 'No matching files' : 'Type to search project files'}
            </ComposerMenuNote>
          )}
          <textarea
            ref={taRef}
            className="composer__input"
            value={text}
            rows={2}
            spellCheck={false}
            disabled={disabled}
            placeholder={
              noClaude
                ? `Claude isn’t running in this terminal. Press ${k('⌘R', 'Ctrl+Shift+R')} to use the terminal`
                : disabled
                  ? 'Answer Claude above to continue…'
                  : 'Message Claude…  ⏎ send · ⇧⏎ newline · / commands · @ files'
            }
            onChange={(e) => {
              navRef.current = IDLE_NAV
              setDismissed(null)
              setCaret(e.target.selectionStart)
              setText(e.target.value)
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => {
              if (e.key === ' ' && spaceHeld.current) {
                spaceHeld.current = false
                voice.stop()
              }
            }}
            onBlur={() => {
              if (spaceHeld.current) {
                spaceHeld.current = false
                voice.stop()
              }
            }}
          />
        </div>
        <div className="composer__actions">
          <button
            className="iconbtn iconbtn--sm"
            title="Attach files or images"
            disabled={disabled}
            onClick={() => void pickAndAttach(leafId)}
          >
            <Paperclip size={13} />
          </button>
          <span className="composer__slot composer__slot--voice" data-composer-slot="voice">
            <button
              className={`iconbtn iconbtn--sm composer__mic${voiceOn ? ' iconbtn--active composer__mic--on' : ''}`}
              title="Voice: hold to talk, or click to start and click again to stop (holding Space in an empty box works too). Uses Claude Code's own voice mode, so it needs a claude.ai login (Linux also needs SoX). DockTerm records nothing."
              aria-label="Voice input"
              aria-pressed={voiceOn}
              disabled={micDisabled}
              // Keep the caret in the text box so the transcript lands there.
              onMouseDown={(e) => e.preventDefault()}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                const a = gesture.down(voice.isActive())
                if (a === 'start') void voice.start()
                else if (a === 'stop') voice.stop()
              }}
              onPointerUp={() => {
                if (gesture.up() === 'stop') voice.stop()
              }}
              onPointerCancel={() => {
                if (gesture.up() === 'stop') voice.stop()
              }}
              onClick={(e) => {
                // keyboard activation (Enter / Space on the focused button) toggles
                if (e.detail !== 0) return
                if (voice.isActive()) voice.stop()
                else void voice.start()
              }}
            >
              <Mic size={13} />
            </button>
          </span>
          <button
            className="iconbtn iconbtn--sm"
            title="Interrupt Claude (Esc)"
            onClick={() => paneWriters.write(leafId, ESC)}
          >
            <Square size={13} />
          </button>
          <button
            className="iconbtn iconbtn--sm"
            title={`Open the big editor (${k('⌘⇧⏎', 'Ctrl+Shift+⏎')})`}
            onClick={() => useComposeStore.getState().openCompose()}
          >
            <Maximize2 size={13} />
          </button>
          <button className="btn btn--primary btn--sm" disabled={!canSend} onClick={() => void send()}>
            <CornerDownLeft size={13} /> Send
          </button>
        </div>
      </div>
    </div>
  )
}
