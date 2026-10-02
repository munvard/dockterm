/** Free space the top bar always keeps between its two groups, so the window can
 * be grabbed and moved at any width. */
export const MIN_DRAG_GAP = 48

/** The narrowest the project name is truncated to before anything else gives way. */
export const NAME_MIN = 72

/** Natural widths (px) of everything in the top bar, measured in its full state.
 * null = the item is not rendered at all. */
export interface TopBarMeasure {
  /** The bar's content width (its width minus its padding). */
  avail: number
  /** Flex gap between items in both groups. */
  gap: number
  minDrag: number
  /** Left items that never change (open project, new window). */
  leftFixed: number[]
  name: number | null
  nameMin: number
  branch: number | null
  /** The branch chip with only its icon. */
  branchIcon: number
  sync: number | null
  chip: number | null
  /** The changed chip with only its count. */
  chipShort: number
  agent: number | null
  pill: number | null
  /** The usage pill without its reset countdowns. */
  pillCompact: number
  /** Dock-panel icons, in order; the trailing ones collapse into "more". */
  panels: number[]
  /** The "more" overflow button. */
  more: number
  /** Right items that never change (divider, notes, zen, reading, mini terminal). */
  rightFixed: number[]
}

export interface TopBarPlan {
  chipShort: boolean
  /** null = natural width, 0 = hidden, otherwise the max width of the name. */
  nameWidth: number | null
  branch: 'full' | 'icon' | 'hidden'
  syncHidden: boolean
  pillCompact: boolean
  /** How many panel icons stay in the bar. */
  panels: number
  /** Free drag space left between the groups with this plan. */
  free: number
}

/** Width of a flex row: present items plus the gaps between them. */
function rowWidth(items: (number | null)[], gap: number): number {
  const present = items.filter((w): w is number => w !== null)
  if (present.length === 0) return 0
  return present.reduce((s, w) => s + w, 0) + gap * (present.length - 1)
}

/**
 * Which items give way, and how far, so the top bar keeps `minDrag` px of free
 * space. Items give way in a fixed priority: the changed chip drops its word, the
 * project name truncates, the branch chip shrinks to its icon, the usage pill drops
 * its reset countdown, panel icons collapse into "more" from the end, and only then
 * do the name, the branch and the ahead/behind counts disappear. When the name was
 * truncated and a later step freed more than needed, the slack goes back to it.
 */
export function planTopBar(m: TopBarMeasure): TopBarPlan {
  const s = {
    chipShort: false,
    name: 'full' as 'full' | 'min' | 'hidden',
    branch: 'full' as TopBarPlan['branch'],
    syncHidden: false,
    pillCompact: false,
    panels: m.panels.length
  }
  const nameMin = m.name === null ? null : Math.min(m.name, m.nameMin)
  const free = (): number => {
    const left = rowWidth(
      [
        ...m.leftFixed,
        s.name === 'hidden' ? null : s.name === 'min' ? nameMin : m.name,
        m.branch === null || s.branch === 'hidden' ? null : s.branch === 'icon' ? m.branchIcon : m.branch,
        s.syncHidden ? null : m.sync,
        m.chip === null ? null : s.chipShort ? m.chipShort : m.chip
      ],
      m.gap
    )
    const shown = m.panels.slice(0, s.panels)
    const right = rowWidth(
      [
        m.agent,
        m.pill === null ? null : s.pillCompact ? m.pillCompact : m.pill,
        // The panels row is always rendered (even when empty), so it always takes a gap.
        rowWidth(shown, m.gap),
        s.panels < m.panels.length ? m.more : null,
        ...m.rightFixed
      ],
      m.gap
    )
    return m.avail - left - right
  }

  const steps: (() => void)[] = [
    () => (s.chipShort = true),
    () => (s.name = 'min'),
    () => (s.branch = 'icon'),
    () => (s.pillCompact = true),
    ...m.panels.map(() => () => void s.panels--),
    () => (s.name = 'hidden'),
    () => (s.branch = 'hidden'),
    () => (s.syncHidden = true)
  ]
  for (const step of steps) {
    if (free() >= m.minDrag) break
    step()
  }

  const left = free()
  let nameWidth: number | null = null
  if (m.name !== null && nameMin !== null) {
    if (s.name === 'hidden') nameWidth = 0
    else if (s.name === 'min') {
      const w = Math.floor(nameMin + Math.max(0, left - m.minDrag))
      nameWidth = w >= m.name ? null : w
    }
  }
  return {
    chipShort: s.chipShort,
    nameWidth,
    branch: m.branch === null ? 'full' : s.branch,
    syncHidden: s.syncHidden,
    pillCompact: s.pillCompact,
    panels: s.panels,
    free: nameWidth === null || nameWidth === 0 ? left : left - (nameWidth - (nameMin ?? 0))
  }
}
