import { useLayoutEffect, useRef } from 'react'
import { SquareTerminal } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useAgentStore } from '../../state/useAgentStore'
import { UsagePill } from '../usage/UsagePill'
import { AgentPill } from '../agents/AgentPill'
import { NotesButton } from './NotesButton'
import { PANELS } from './panels'

/**
 * The top bar's right-hand tools (usage pill, dock-panel icons, notes, mini
 * terminal). They always live in the top bar; when the window gets too narrow to
 * fit them all, the trailing (least-important) ones are hidden — and they come
 * back as soon as there's room again. Pure width measurement, no hard-coded
 * breakpoints, so it adapts to any size.
 */
export function TopBarTools() {
  const openPanel = useAppStore((s) => s.openPanel)
  const togglePanel = useAppStore((s) => s.togglePanel)
  const miniTermOpen = useAppStore((s) => s.miniTermOpen)
  const toggleMini = useAppStore((s) => s.toggleMiniTerm)
  const usageEnabled = useAppStore((s) => s.settings?.usage.enabled) ?? true
  // Subscribe to the live agent count so this component re-renders (and its
  // measurement effect below re-runs) the moment the agent pill appears/disappears
  // — otherwise the pill mounts without the overflow layout being recomputed.
  const agentActive = useAgentStore((s) => s.activity?.activeCount ?? 0)

  // Hide the Usage dock icon when the user has turned Usage off.
  const panels = PANELS.filter((p) => p.id !== 'usage' || usageEnabled)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const wrap = ref.current
    const topbar = wrap?.closest('.topbar') as HTMLElement | null
    const left = topbar?.querySelector('.topbar__left') as HTMLElement | null
    if (!wrap || !topbar || !left) return

    const fit = (): void => {
      const items = Array.from(wrap.children) as HTMLElement[]
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
      // Space for the tools = everything to the right of the left group's content.
      const available = barRect.width - leftStart - leftContent - rightPad - gap - 4

      let used = 0
      for (const el of items) {
        used += el.offsetWidth + gap
        el.style.display = used > available ? 'none' : ''
      }
      // Don't leave a divider dangling as the last visible item.
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].style.display === 'none') continue
        if (items[i].classList.contains('topbar__divider')) items[i].style.display = 'none'
        break
      }
    }

    fit()
    // Observe the topbar (its width = the window width, so this never feeds back
    // on itself when we hide items). Re-running on every render also catches
    // left-side content changes (project name / branch / changed-count).
    const ro = new ResizeObserver(fit)
    ro.observe(topbar)
    return () => ro.disconnect()
  })

  return (
    <div className="topbar__right" ref={ref} data-agents={agentActive}>
      <AgentPill />
      <UsagePill />
      {panels.map((panel) => {
        const Icon = panel.icon
        return (
          <button
            key={panel.id}
            className={`iconbtn tip--end${openPanel === panel.id ? ' iconbtn--active' : ''}`}
            data-tip={panel.label}
            aria-label={panel.label}
            onClick={() => togglePanel(panel.id)}
          >
            <Icon size={15} />
          </button>
        )
      })}
      <span className="topbar__divider" />
      <NotesButton />
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
