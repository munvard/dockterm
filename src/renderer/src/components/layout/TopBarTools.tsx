import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, SquareTerminal, Maximize2, MoreHorizontal } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useAgentStore } from '../../state/useAgentStore'
import { UsagePill } from '../usage/UsagePill'
import { AgentPill } from '../agents/AgentPill'
import { NotesButton } from './NotesButton'
import { PANELS } from './panels'
import { k } from '../../hooks/keys'

/**
 * The top bar's right-hand tools (usage pill, dock-panel icons, notes, mini
 * terminal). They always live in the top bar; when the window gets too narrow to
 * fit them all, the trailing panel icons collapse into a "more" overflow menu
 * instead of disappearing outright — Notes/Zen/Reading/mini-terminal always stay
 * reachable, and the panels menu comes back as soon as there's room again. Pure
 * width measurement, no hard-coded breakpoints, so it adapts to any size.
 */
export function TopBarTools() {
  const openPanel = useAppStore((s) => s.openPanel)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const miniTermOpen = useAppStore((s) => s.miniTermOpen)
  const toggleMini = useAppStore((s) => s.toggleMiniTerm)
  const toggleZen = useAppStore((s) => s.toggleZen)
  const toggleReading = useAppStore((s) => s.toggleReading)
  const readingOpen = useAppStore((s) => s.readingOpen)
  const usageEnabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  // Subscribe to the live agent count so this component re-renders (and its
  // measurement effect below re-runs) the moment the agent pill appears/disappears
  // — otherwise the pill mounts without the overflow layout being recomputed.
  const agentActive = useAgentStore((s) => s.activity?.activeCount ?? 0)

  // Hide the Usage dock icon when the user has turned Usage off.
  const panels = PANELS.filter((p) => p.id !== 'usage' || usageEnabled)
  const ref = useRef<HTMLDivElement>(null)
  const panelsRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(panels.length)
  const [overflowOpen, setOverflowOpen] = useState(false)

  useLayoutEffect(() => {
    const wrap = ref.current
    const panelsWrap = panelsRef.current
    const topbar = wrap?.closest('.topbar') as HTMLElement | null
    const left = topbar?.querySelector('.topbar__left') as HTMLElement | null
    if (!wrap || !panelsWrap || !topbar || !left) return

    const fit = (): void => {
      const items = Array.from(panelsWrap.children) as HTMLElement[]
      for (const el of items) el.style.display = '' // show all to measure
      const barRect = topbar.getBoundingClientRect()
      const leftStart = left.getBoundingClientRect().left - barRect.left
      const cs = getComputedStyle(topbar)
      const rightPad = parseFloat(cs.paddingRight) || 8
      const gap = parseFloat(getComputedStyle(wrap).columnGap || '8') || 8
      // The left group is flex:1, so it stretches — its scrollWidth would be the
      // whole stretched box, not its content. Sum its children for the real
      // content width instead.
      const leftKids = Array.from(left.children) as HTMLElement[]
      const leftGap = parseFloat(getComputedStyle(left).columnGap || '8') || 8
      const leftContent =
        leftKids.reduce((s, c) => s + c.offsetWidth, 0) + leftGap * Math.max(0, leftKids.length - 1)
      // Fixed-width siblings that never collapse (agent/usage pills, the "more"
      // button, divider, notes, zen, reading, mini-terminal) — reserve a
      // constant slot for "more" even when it isn't shown yet, so it can never
      // itself cause a second overflow pass.
      const fixedKids = Array.from(wrap.children).filter(
        (c) => c !== panelsWrap && !c.classList.contains('topbar__overflow')
      ) as HTMLElement[]
      const fixedWidth = fixedKids.reduce((s, c) => s + c.offsetWidth + gap, 0)
      const moreBtnWidth = 30
      const available =
        barRect.width - leftStart - leftContent - rightPad - gap - 4 - fixedWidth - moreBtnWidth

      let used = 0
      let fitCount = items.length
      for (let i = 0; i < items.length; i++) {
        used += items[i].offsetWidth + gap
        if (used > available) {
          fitCount = i
          break
        }
      }
      setVisibleCount(fitCount)
    }

    fit()
    // Observe the topbar (its width = the window width, so this never feeds back
    // on itself when we hide items). Re-running on every render also catches
    // left-side content changes (project name / branch / changed-count).
    const ro = new ResizeObserver(fit)
    ro.observe(topbar)
    return () => ro.disconnect()
  })

  useEffect(() => {
    if (!overflowOpen) return
    const close = (): void => setOverflowOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOverflowOpen(false)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [overflowOpen])

  const hiddenPanels = panels.slice(visibleCount)

  return (
    <div className="topbar__right" ref={ref} data-agents={agentActive}>
      <AgentPill />
      <UsagePill />
      <div className="topbar__panels" ref={panelsRef}>
        {panels.map((panel, i) => {
          const Icon = panel.icon
          return (
            <button
              key={panel.id}
              className={`iconbtn tip--end${openPanel === panel.id ? ' iconbtn--active' : ''}`}
              data-tip={panel.label}
              aria-label={panel.label}
              style={i >= visibleCount ? { display: 'none' } : undefined}
              onClick={() => togglePanel(panel.id)}
            >
              <Icon size={15} />
            </button>
          )
        })}
      </div>
      {hiddenPanels.length > 0 && (
        <div className="topbar__overflow">
          <button
            className={`iconbtn tip--end${overflowOpen ? ' iconbtn--active' : ''}`}
            data-tip="More"
            aria-label="More panels"
            onClick={(e) => {
              e.stopPropagation()
              setOverflowOpen((v) => !v)
            }}
          >
            <MoreHorizontal size={15} />
          </button>
          {overflowOpen && (
            <div className="ctxmenu" onClick={(e) => e.stopPropagation()}>
              {hiddenPanels.map((panel) => {
                const Icon = panel.icon
                return (
                  <button
                    key={panel.id}
                    className={openPanel === panel.id ? 'is-active' : ''}
                    onClick={() => {
                      togglePanel(panel.id)
                      setOverflowOpen(false)
                    }}
                  >
                    <Icon size={13} /> {panel.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      <span className="topbar__divider" />
      <NotesButton />
      <button
        className="iconbtn tip--end"
        data-tip={`Zen mode (${k('⌘.', 'Ctrl+Shift+.')})`}
        aria-label="Zen mode"
        onClick={toggleZen}
      >
        <Maximize2 size={15} />
      </button>
      <button
        className={`iconbtn tip--end${readingOpen ? ' iconbtn--active' : ''}`}
        data-tip="Reading view"
        aria-label="Toggle reading view"
        onClick={toggleReading}
      >
        <BookOpen size={15} />
      </button>
      <button
        className={`iconbtn tip--end${miniTermOpen ? ' iconbtn--active' : ''}`}
        data-tip="Mini terminal"
        aria-label="Mini terminal"
        onClick={toggleMini}
      >
        <SquareTerminal size={15} />
      </button>
    </div>
  )
}
