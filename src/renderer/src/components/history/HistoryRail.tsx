import { useEffect, useRef, useState } from 'react'
import {
  Milestone,
  RotateCcw,
  ClipboardCopy,
  CornerDownRight,
  MoreHorizontal,
  Loader2,
  X
} from 'lucide-react'
import type { SessionPrompt } from '@shared/types'
import { useSessionHistoryStore, normalizeCwd } from '../../state/useSessionHistoryStore'
import { useAppStore } from '../../state/useAppStore'
import { useToastStore } from '../../state/useToastStore'
import { getPaneSample, paneBufferType } from '../terminal/terminalPool'
import { scrollToCheckpoint } from '../terminal/claudeScrollTo'
import { paneWriters } from '../../state/paneWriters'

/**
 * The checkpoints rail: the user's prompts for the focused project, read-only from
 * the transcript. Clicking a checkpoint jumps the terminal to it (by driving
 * Claude's own scroll) and reveals its full text here. "Rewind to here" hands off
 * to Claude Code's own `/rewind` (the only safe way — Claude exposes no rewind
 * API), so the user confirms the restore in Claude's menu.
 */
export function HistoryRail({ cwd, leafId }: { cwd: string | null; leafId: string | null }) {
  const history = useSessionHistoryStore((s) => (cwd ? s.byCwd[normalizeCwd(cwd)] : undefined))
  const load = useSessionHistoryStore((s) => s.load)
  const toggleHistory = useAppStore((s) => s.toggleHistory)
  const toast = useToastStore((s) => s.push)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [openFor, setOpenFor] = useState<number | null>(null)
  const [jumping, setJumping] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  // Live row elements so we can scroll the rail back to the picked checkpoint.
  const rowEls = useRef(new Map<number, HTMLDivElement>())

  // Bind to the session running in THIS terminal by fingerprinting its buffer, and
  // keep it fresh (new prompts, or a switch to another session) by re-sampling. The
  // binding is sticky while Claude is running (claudeActive) so scrolling the
  // terminal away from the bottom doesn't blank the rail.
  useEffect(() => {
    if (!cwd) return
    const refresh = (): void => {
      const sample = leafId ? getPaneSample(leafId) : []
      const claudeActive = leafId ? paneBufferType(leafId) === 'alternate' : false
      void load(cwd, leafId ?? '', sample, claudeActive)
    }
    refresh()
    const iv = setInterval(refresh, 2500)
    return () => clearInterval(iv)
  }, [cwd, leafId, load])

  useEffect(() => {
    if (menuFor === null) return
    const close = (): void => setMenuFor(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menuFor])

  // A different pane/project means a different conversation — drop any selection so
  // the highlight never points at an unrelated prompt.
  useEffect(() => {
    setSelected(null)
    setOpenFor(null)
    setMenuFor(null)
  }, [cwd, leafId])

  const prompts = history?.prompts ?? []

  // Bring the picked checkpoint's row to the top of the rail (so its inline text is
  // fully visible) — and keep it marked selected so it's easy to find again after
  // scrolling around the list.
  const revealRow = (index: number): void => {
    requestAnimationFrame(() =>
      rowEls.current.get(index)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    )
  }

  // Open a checkpoint: reveal its full text here (always reliable, from the
  // transcript) AND jump the terminal to it. The jump drives Claude's own scroll
  // (page up until the prompt is on screen) — for a very old prompt it may scroll
  // past the top without reaching it, in which case the inline text is the fallback.
  const openPrompt = (p: SessionPrompt): void => {
    const willOpen = openFor !== p.index
    setOpenFor(willOpen ? p.index : null)
    setSelected(p.index)
    if (willOpen) revealRow(p.index)
    if (!leafId) return
    setJumping(p.index)
    void scrollToCheckpoint(leafId, p.preview).then((outcome) => {
      setJumping((cur) => (cur === p.index ? null : cur))
      if (outcome === 'notfound')
        toast('Couldn’t scroll that far back — showing the full text here', 'info')
    })
  }
  const rewind = (p: SessionPrompt): void => {
    setMenuFor(null)
    if (!leafId || !paneWriters.write(leafId, '/rewind\r')) {
      toast('Open a Claude session in this pane first', 'error')
      return
    }
    toast(`Opened Claude’s rewind — pick “${p.preview.slice(0, 24)}…” and the mode there`, 'info')
  }
  const copyPrompt = (p: SessionPrompt): void => {
    void navigator.clipboard.writeText(p.text)
    setMenuFor(null)
    toast('Prompt copied', 'success')
  }

  return (
    <div className="hist">
      <div className="hist__head">
        <span className="hist__title">
          <Milestone size={13} /> Checkpoints
        </span>
        <button className="iconbtn iconbtn--sm" title="Hide checkpoints" onClick={toggleHistory}>
          <X size={14} />
        </button>
      </div>
      <div className="hist__body">
        {prompts.length === 0 ? (
          <div className="hist__empty">
            No prompts yet. Your messages to Claude show up here — click one to jump back to it.
          </div>
        ) : (
          [...prompts].reverse().map((p) => (
            <div
              className={`hist__row${openFor === p.index ? ' hist__row--open' : ''}${
                selected === p.index ? ' hist__row--selected' : ''
              }`}
              key={p.index}
              ref={(el) => {
                if (el) rowEls.current.set(p.index, el)
                else rowEls.current.delete(p.index)
              }}
            >
              <div
                className="hist__line"
                onClick={() => openPrompt(p)}
                title="Jump the terminal to this checkpoint"
              >
                <span className="hist__idx">
                  {jumping === p.index ? <Loader2 size={11} className="spin" /> : p.index + 1}
                </span>
                <span className="hist__text">{p.preview}</span>
                <button
                  className="hist__more"
                  title="Actions"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuFor(menuFor === p.index ? null : p.index)
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>
              {openFor === p.index && <div className="hist__full">{p.text}</div>}
              {menuFor === p.index && (
                <div className="hist__menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      openPrompt(p)
                      setMenuFor(null)
                    }}
                  >
                    <CornerDownRight size={13} /> Open / scroll here
                  </button>
                  <button onClick={() => copyPrompt(p)}>
                    <ClipboardCopy size={13} /> Copy prompt
                  </button>
                  <button onClick={() => rewind(p)}>
                    <RotateCcw size={13} /> Rewind to here…
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <div className="hist__note">
        Click a checkpoint to jump the terminal to it and read it here in full. To restore your
        files to that point, use “Rewind” — it opens Claude’s own <code>/rewind</code> so you
        confirm the restore there.
      </div>
    </div>
  )
}
