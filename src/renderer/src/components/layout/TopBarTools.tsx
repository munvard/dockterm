import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen, SquareTerminal, Maximize2, MoreHorizontal } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { UsagePill } from '../usage/UsagePill'
import { AgentPill } from '../agents/AgentPill'
import { NotesButton } from './NotesButton'
import { PANELS } from './panels'
import { planTopBar, MIN_DRAG_GAP, NAME_MIN } from './topBarFit'
import { k } from '../../hooks/keys'

/**
 * The top bar's right-hand tools (usage pill, dock-panel icons, notes, mini
 * terminal). They always live in the top bar; when the window gets too narrow to
 * fit them all, the trailing panel icons collapse into a "more" overflow menu
 * instead of disappearing outright — Notes/Zen/Reading/mini-terminal always stay
 * reachable, and the panels menu comes back as soon as there's room again. The
 * same measurement shortens the left side first (see planTopBar) and always keeps
 * a free gap between the groups to grab the window by. Pure width measurement, no
 * hard-coded breakpoints, so it adapts to any size and zoom.
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

    // Layout width plus margins: offsetWidth ignores transforms (the agent pill's
    // entry animation scales it).
    const width = (el: Element | null | undefined): number | null => {
      if (!(el instanceof HTMLElement)) return null
      const st = getComputedStyle(el)
      return el.offsetWidth + (parseFloat(st.marginLeft) || 0) + (parseFloat(st.marginRight) || 0)
    }
    const fit = (): void => {
      // Back to the full state with nothing squeezed (fitMeasure), measure it,
      // then apply the plan.
      for (const key of ['fitChip', 'fitBranch', 'fitName', 'fitSync', 'fitPill']) delete topbar.dataset[key]
      topbar.dataset.fitMeasure = ''
      const nameEl = left.querySelector<HTMLElement>('.topbar__name')
      if (nameEl) nameEl.style.maxWidth = ''
      const items = Array.from(panelsWrap.children) as HTMLElement[]
      for (const el of items) el.style.display = ''

      const cs = getComputedStyle(topbar)
      const gap = parseFloat(getComputedStyle(left).columnGap) || 8
      const branchEl = left.querySelector('.topbar__branch')
      const chipEl = left.querySelector('.topbar__left > .chip')
      const pillEl = wrap.querySelector('.usage-pill')
      const pillW = width(pillEl)
      const resets = pillEl ? Array.from(pillEl.querySelectorAll('.uv-reset')) : []
      const itemGap = resets[0]?.parentElement ? parseFloat(getComputedStyle(resets[0].parentElement).columnGap) || 0 : 0
      const resetW = resets.reduce((s, r) => s + (width(r) ?? 0) + itemGap, 0)
      const branchW = width(branchEl)
      const branchNameW = width(branchEl?.querySelector('.topbar__branch-name')) ?? 0
      const branchGap = branchEl ? parseFloat(getComputedStyle(branchEl).columnGap) || 0 : 0
      const chipW = width(chipEl)
      const chipWordW = width(chipEl?.querySelector('.chip__word')) ?? 0
      const fixedLeft = Array.from(left.children).filter((c) => c.matches('button')) as HTMLElement[]
      const others = Array.from(wrap.children).filter(
        (c) => c !== panelsWrap && c !== pillEl && !c.classList.contains('agent-pill') && !c.classList.contains('topbar__overflow')
      )
      const plan = planTopBar({
        avail: topbar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0),
        gap,
        minDrag: MIN_DRAG_GAP,
        leftFixed: fixedLeft.map((c) => width(c) ?? 0),
        name: width(nameEl),
        nameMin: NAME_MIN,
        branch: branchW,
        branchIcon: branchW === null ? 0 : branchW - branchNameW - branchGap,
        sync: width(left.querySelector('.topbar__sync')),
        chip: chipW,
        chipShort: chipW === null ? 0 : chipW - chipWordW,
        agent: width(wrap.querySelector('.agent-pill')),
        pill: pillW,
        pillCompact: pillW === null ? 0 : pillW - resetW,
        panels: items.map((el) => width(el) ?? 0),
        more: width(fixedLeft[0]) ?? 26,
        rightFixed: others.map((c) => width(c) ?? 0)
      })
      delete topbar.dataset.fitMeasure

      if (plan.chipShort) topbar.dataset.fitChip = 'short'
      if (plan.branch !== 'full') topbar.dataset.fitBranch = plan.branch
      if (plan.syncHidden) topbar.dataset.fitSync = 'hidden'
      if (plan.pillCompact) topbar.dataset.fitPill = 'compact'
      if (plan.nameWidth === 0) topbar.dataset.fitName = 'hidden'
      else if (nameEl && plan.nameWidth !== null) nameEl.style.maxWidth = `${plan.nameWidth}px`
      // Measuring un-hid everything above. Re-hide the overflow NOW: when the
      // count didn't change, React sees an equal state and never re-applies its
      // display:none, so the hidden icons would stay on screen.
      items.forEach((el, i) => {
        el.style.display = i >= plan.panels ? 'none' : ''
      })
      setVisibleCount(plan.panels)
    }

    fit()
    // The bar's width is the window's, so resizing never feeds back on itself.
    // Content changes (project, branch, changed count, the usage pill's numbers,
    // the agent pill appearing) are text and node changes; fit only touches
    // attributes, which are not observed, so this cannot loop either.
    const ro = new ResizeObserver(fit)
    ro.observe(topbar)
    const mo = new MutationObserver(fit)
    mo.observe(topbar, { childList: true, subtree: true, characterData: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [panels.length])

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
    <div className="topbar__right" ref={ref}>
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
