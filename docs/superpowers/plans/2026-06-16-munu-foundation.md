# munu Foundation (Branding + Detection Engine + In-app munu) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand DockTerm to munu and make a small in-app munu face mirror Claude Code's live state (idle / working / asking / done) across all panes.

**Architecture:** Each terminal classifies its own xterm buffer (clean text) with a pure ported-from-Notchy classifier; per-pane states feed a zustand store that computes a windowed aggregate with a 3s idle→done settle; a top-bar component renders the matching munu SVG. This is Phases 1–2 of the munu spec; the floating overlay, permission HUD, and polish are later plans.

**Tech Stack:** Electron 42, React 19, TypeScript (strict), zustand, xterm.js 6, vitest 4, electron-builder 26.

**Spec:** `docs/superpowers/specs/2026-06-16-dockterm-munu-presence-design.md`

---

## File structure

- `build/icon.icns` / `build/icon.ico` / `build/icon.png` (replace) — app/installer icons (munu).
- `electron-builder.yml` (modify) — point mac/win/linux icons at the munu files.
- `README.md` (modify) — munu header + logo.
- `assets/brand/` (create) — `dockterm-logo.svg`, `dockterm-logo-light.svg` for the README.
- `src/renderer/src/assets/munu/*.svg` (create) — munu state art importable by Vite.
- `src/renderer/src/components/terminal/claudeStatus.ts` (create) — pure classifier + `parseAsk`.
- `src/renderer/src/state/munuAggregate.ts` (create) — pure aggregation (hierarchy).
- `src/renderer/src/state/useMunuStore.ts` (create) — per-pane status + aggregate + settle timer.
- `src/renderer/src/components/terminal/useTerminal.ts` (modify) — classify on debounced data, `onStatus`.
- `src/renderer/src/components/terminal/TerminalView.tsx` (modify) — forward `onStatus`.
- `src/renderer/src/components/terminal/PaneTree.tsx` (modify) — wire `onStatus` → store, prune on close.
- `src/renderer/src/components/munu/MunuFace.tsx` (create) — renders the SVG for a state.
- `src/renderer/src/components/munu/TopBarMunu.tsx` (create) — top-bar munu + popover.
- `src/renderer/src/components/layout/TopBar.tsx` (modify) — mount `TopBarMunu`.
- `tests/unit/claudeStatus.test.ts`, `tests/unit/munuAggregate.test.ts` (create).

---

## Phase 1 — Branding

### Task 1: Swap the app/installer icon to munu

**Files:**
- Copy: `assets/munu/icon.icns` → `build/icon.icns`, `assets/munu/icon.ico` → `build/icon.ico`, `assets/munu/icon.png` → `build/icon.png`
- Modify: `electron-builder.yml`

- [ ] **Step 1: Copy the icon files into build/**

```bash
cp assets/munu/icon.icns build/icon.icns
cp assets/munu/icon.ico  build/icon.ico
cp assets/munu/icon.png  build/icon.png
```

- [ ] **Step 2: Point each platform at its icon in `electron-builder.yml`**

Under `mac:` add `icon: build/icon.icns`; under `win:` add `icon: build/icon.ico`; `linux:` already has `icon: build/icon.png` (leave it). If a top-level `icon:` exists, leave it pointing at `build/icon.png`.

- [ ] **Step 3: Verify the bundle still builds**

Run: `npm run build`
Expected: `✓ built` with no icon errors.

- [ ] **Step 4: Commit**

```bash
git add build/icon.icns build/icon.ico build/icon.png electron-builder.yml
git commit -m "feat(brand): munu app + installer icon"
```

### Task 2: munu README header + logo

**Files:**
- Create: `assets/brand/dockterm-logo.svg`, `assets/brand/dockterm-logo-light.svg`
- Modify: `README.md`

- [ ] **Step 1: Copy the logos**

```bash
mkdir -p assets/brand
cp assets/munu/dockterm-logo.svg assets/brand/dockterm-logo.svg
cp assets/munu/dockterm-logo-light.svg assets/brand/dockterm-logo-light.svg
```

- [ ] **Step 2: Replace the README top block** (the `<div align="center">…</div>` header through the first `---`) with the munu header from `assets/munu/README-snippet.md` (the `<picture>` logo block, tagline "the calm workspace for Claude Code — your terminal, with a face", badges, and the "Meet munu" states table using `assets/brand/munu*.svg`). Copy the referenced state SVGs too:

```bash
cp assets/munu/munu.svg assets/munu/munu-happy.svg assets/munu/munu-working.svg assets/munu/munu-sleeping.svg assets/munu/munu-asking.svg assets/brand/
```

- [ ] **Step 3: Commit**

```bash
git add README.md assets/brand
git commit -m "docs(brand): munu README header, logo, and state table"
```

---

## Phase 2 — Detection engine + in-app munu

### Task 3: Pure Claude-status classifier

**Files:**
- Create: `src/renderer/src/components/terminal/claudeStatus.ts`
- Test: `tests/unit/claudeStatus.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { classify, parseAsk } from '@renderer/components/terminal/claudeStatus'

describe('classify', () => {
  it('detects working from the token-counter spinner line', () => {
    expect(classify('✻ Thinking… (12s · 1.2k tokens)')).toBe('working')
  })
  it('detects working from "esc to interrupt"', () => {
    expect(classify('Running tool (esc to interrupt)')).toBe('working')
  })
  it('detects asking from a numbered prompt menu', () => {
    expect(classify('Do you want to proceed?\n❯ 1. Yes\n  2. No')).toBe('asking')
  })
  it('detects asking from "Esc to cancel"', () => {
    expect(classify('Enter to confirm · Esc to cancel')).toBe('asking')
  })
  it('returns idle for ordinary output', () => {
    expect(classify('$ ls\nREADME.md\n$ ')).toBe('idle')
  })
})

describe('parseAsk', () => {
  it('pulls the question/command line above the menu', () => {
    const text = 'Claude wants to run a command\n  npm install\n❯ 1. Yes\n  2. No'
    expect(parseAsk(text)).toContain('npm install')
  })
  it('returns null when not asking', () => {
    expect(parseAsk('just output')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/claudeStatus.test.ts`
Expected: FAIL ("classify is not a function").

- [ ] **Step 3: Implement the classifier**

```ts
export type ClaudeState = 'idle' | 'working' | 'asking'

const SPINNERS = new Set(['·', '✢', '✳', '✶', '✻', '✽'])

/** A line like "✻ Thinking… (…)" — spinner char, space, contains an ellipsis. */
function hasTokenCounterLine(text: string): boolean {
  return text.split('\n').some((line) => {
    const first = line[0]
    return !!first && SPINNERS.has(first) && line[1] === ' ' && line.includes('…')
  })
}

/** A permission-menu line: (trim-left) "❯ " followed by a digit. */
function hasUserPrompt(text: string): boolean {
  return text.split('\n').some((line) => {
    const t = line.replace(/^ +/, '')
    return t.startsWith('❯ ') && /\d/.test(t[2] ?? '')
  })
}

export function classify(text: string): ClaudeState {
  if (hasTokenCounterLine(text) || text.includes('esc to interrupt')) return 'working'
  if (text.includes('Esc to cancel') || hasUserPrompt(text)) return 'asking'
  return 'idle'
}

/** Best-effort: the lines between a "wants to"/question line and the menu. */
export function parseAsk(text: string): string | null {
  if (classify(text) !== 'asking') return null
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const menuIdx = lines.findIndex((l) => /^\s*❯ \d/.test(l) || l.includes('Esc to cancel'))
  if (menuIdx < 0) return null
  const above = lines
    .slice(Math.max(0, menuIdx - 4), menuIdx)
    .map((l) => l.trim())
    .filter(Boolean)
  return above.length ? above.join('\n') : null
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/claudeStatus.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/terminal/claudeStatus.ts tests/unit/claudeStatus.test.ts
git commit -m "feat(munu): pure Claude-state classifier (ported from Notchy heuristics)"
```

### Task 4: Pure aggregation

**Files:**
- Create: `src/renderer/src/state/munuAggregate.ts`
- Test: `tests/unit/munuAggregate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { aggregate, type MunuState } from '@renderer/state/munuAggregate'

const s = (...states: MunuState[]): MunuState[] => states

describe('aggregate', () => {
  it('asking beats working beats idle', () => {
    expect(aggregate(s('idle', 'working', 'asking'))).toBe('asking')
    expect(aggregate(s('idle', 'working'))).toBe('working')
    expect(aggregate(s('idle', 'idle'))).toBe('idle')
  })
  it('done beats everything when present', () => {
    expect(aggregate(s('working', 'done', 'asking'))).toBe('done')
  })
  it('empty → idle', () => {
    expect(aggregate([])).toBe('idle')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/munuAggregate.test.ts`
Expected: FAIL ("aggregate is not a function").

- [ ] **Step 3: Implement**

```ts
// 'done' is a transient celebration state derived in the store (idle→done settle).
export type MunuState = 'idle' | 'working' | 'asking' | 'done'

const PRIORITY: MunuState[] = ['done', 'asking', 'working', 'idle']

export function aggregate(states: MunuState[]): MunuState {
  for (const p of PRIORITY) if (states.includes(p)) return p
  return 'idle'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/munuAggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/state/munuAggregate.ts tests/unit/munuAggregate.test.ts
git commit -m "feat(munu): pure state aggregation (done>asking>working>idle)"
```

### Task 5: munu store (per-pane status + settle to 'done')

**Files:**
- Create: `src/renderer/src/state/useMunuStore.ts`

- [ ] **Step 1: Implement the store**

```ts
import { create } from 'zustand'
import { aggregate, type MunuState } from './munuAggregate'
import type { ClaudeState } from '../components/terminal/claudeStatus'

interface PaneStatus {
  state: ClaudeState
  ask: string | null
}

interface MunuStore {
  panes: Record<string, PaneStatus>
  /** transient 'done' flags per leaf, set when working→idle settles */
  done: Record<string, boolean>
  setPaneStatus: (leafId: string, state: ClaudeState, ask: string | null) => void
  removePane: (leafId: string) => void
  munuState: () => MunuState
}

const SETTLE_MS = 3000
const timers: Record<string, ReturnType<typeof setTimeout>> = {}

export const useMunuStore = create<MunuStore>((set, get) => ({
  panes: {},
  done: {},

  setPaneStatus: (leafId, state, ask) => {
    const prev = get().panes[leafId]?.state
    // working → idle: after a settle, flash 'done'
    if (prev === 'working' && state === 'idle') {
      timers[leafId] = setTimeout(() => {
        if (get().panes[leafId]?.state !== 'idle') return
        set((s) => ({ done: { ...s.done, [leafId]: true } }))
        setTimeout(() => set((s) => ({ done: { ...s.done, [leafId]: false } })), SETTLE_MS)
      }, SETTLE_MS)
    } else if (timers[leafId]) {
      clearTimeout(timers[leafId])
      delete timers[leafId]
    }
    set((s) => ({ panes: { ...s.panes, [leafId]: { state, ask } } }))
  },

  removePane: (leafId) =>
    set((s) => {
      if (timers[leafId]) {
        clearTimeout(timers[leafId])
        delete timers[leafId]
      }
      const panes = { ...s.panes }
      const done = { ...s.done }
      delete panes[leafId]
      delete done[leafId]
      return { panes, done }
    }),

  munuState: () => {
    const { panes, done } = get()
    const states: MunuState[] = Object.entries(panes).map(([id, p]) =>
      done[id] ? 'done' : (p.state as MunuState)
    )
    return aggregate(states)
  }
}))
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/state/useMunuStore.ts
git commit -m "feat(munu): per-pane status store with idle→done settle"
```

### Task 6: Classify in useTerminal and report via onStatus

**Files:**
- Modify: `src/renderer/src/components/terminal/useTerminal.ts`
- Modify: `src/renderer/src/components/terminal/TerminalView.tsx`
- Modify: `src/renderer/src/components/terminal/PaneTree.tsx`

- [ ] **Step 1: Add the `onStatus` option and classifier hook in `useTerminal.ts`**

Add to `TerminalOptions`:

```ts
  /** Reports the pane's inferred Claude state from the rendered buffer. */
  onStatus?: (state: import('./claudeStatus').ClaudeState, ask: string | null) => void
```

Import at top: `import { classify, parseAsk } from './claudeStatus'`.

Inside the main `useEffect`, after `term.open(container)`, add a debounced buffer classifier driven by the existing data flow. Place this near the `safeFit` definition:

```ts
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
```

Call `scheduleStatus()` inside the `pty:data` handler (where `writeChunk(e.data)` runs for the active session) — add it right after `optsRef.current.onActivity?.()`. Also clear it in cleanup: add `if (statusTimer) clearTimeout(statusTimer)` next to the existing `if (fitTimer) clearTimeout(fitTimer)`.

- [ ] **Step 2: Forward `onStatus` in `TerminalView.tsx`**

`onStatus` is part of `TerminalOptions`, which `TerminalView` already spreads into `useTerminal` via `...options`. No change needed beyond confirming `onStatus` isn't destructured away. Verify the `Props` type still spreads `TerminalOptions`.

- [ ] **Step 3: Wire it in `PaneTree.tsx` `TerminalPane`**

Add the store import: `import { useMunuStore } from '../../state/useMunuStore'`. On the `<TerminalView>`:

```tsx
          onStatus={(state, ask) => useMunuStore.getState().setPaneStatus(leaf.id, state, ask)}
```

Prune on unmount — add an effect in `TerminalPane`:

```tsx
  useEffect(() => () => useMunuStore.getState().removePane(leaf.id), [leaf.id])
```

(Import `useEffect` from 'react' if not already imported in PaneTree.)

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/terminal/useTerminal.ts src/renderer/src/components/terminal/TerminalView.tsx src/renderer/src/components/terminal/PaneTree.tsx
git commit -m "feat(munu): classify each pane's buffer and report Claude state"
```

### Task 7: munu art + MunuFace component

**Files:**
- Create: `src/renderer/src/assets/munu/{munu,munu-happy,munu-working,munu-sleeping,munu-asking}.svg`
- Create: `src/renderer/src/components/munu/MunuFace.tsx`

- [ ] **Step 1: Copy the SVGs into the renderer**

```bash
mkdir -p src/renderer/src/assets/munu
cp assets/munu/munu.svg assets/munu/munu-happy.svg assets/munu/munu-working.svg assets/munu/munu-sleeping.svg assets/munu/munu-asking.svg src/renderer/src/assets/munu/
```

- [ ] **Step 2: Implement `MunuFace.tsx`**

```tsx
import type { MunuState } from '../../state/munuAggregate'
import resting from '../../assets/munu/munu.svg'
import happy from '../../assets/munu/munu-happy.svg'
import working from '../../assets/munu/munu-working.svg'
import sleeping from '../../assets/munu/munu-sleeping.svg'
import asking from '../../assets/munu/munu-asking.svg'

/** Maps a munu state (+ project presence) to its art. `done` shows the happy face. */
const ART: Record<MunuState, string> = {
  idle: resting,
  working,
  asking,
  done: happy
}

export function MunuFace({
  state,
  hasProject = true,
  size = 22
}: {
  state: MunuState
  hasProject?: boolean
  size?: number
}) {
  const src = !hasProject ? sleeping : ART[state]
  return <img src={src} width={size} height={size} alt={`munu ${state}`} draggable={false} />
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (Vite types SVG imports as string via its client types).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/assets/munu src/renderer/src/components/munu/MunuFace.tsx
git commit -m "feat(munu): MunuFace component + renderer art"
```

### Task 8: Top-bar munu

**Files:**
- Create: `src/renderer/src/components/munu/TopBarMunu.tsx`
- Modify: `src/renderer/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Implement `TopBarMunu.tsx`**

```tsx
import { useMunuStore } from '../../state/useMunuStore'
import { useAppStore } from '../../state/useAppStore'
import { MunuFace } from './MunuFace'

const LABEL: Record<string, string> = {
  idle: 'resting',
  working: 'working…',
  asking: 'needs you',
  done: 'done'
}

export function TopBarMunu() {
  const state = useMunuStore((s) => s.munuState())
  const hasProject = useAppStore((s) => !!s.project)
  return (
    <div className={`topbar-munu topbar-munu--${state}`} title={`munu · ${LABEL[state]}`}>
      <MunuFace state={state} hasProject={hasProject} size={22} />
    </div>
  )
}
```

Selecting `s.munuState()` re-runs on every store change (the function reads current state); acceptable for this small store.

- [ ] **Step 2: Mount it in `TopBar.tsx`** next to the existing right-side controls (the dock toggle icon cluster). Add `import { TopBarMunu } from '../munu/TopBarMunu'` and render `<TopBarMunu />` at the left edge of that control group.

- [ ] **Step 3: Add minimal styles** in `src/renderer/src/styles/components.css`:

```css
.topbar-munu {
  display: flex;
  align-items: center;
  padding: 0 6px;
}
.topbar-munu--asking {
  animation: munu-pulse 1s ease-in-out infinite;
}
@keyframes munu-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/munu/TopBarMunu.tsx src/renderer/src/components/layout/TopBar.tsx src/renderer/src/styles/components.css
git commit -m "feat(munu): in-app top-bar munu reflecting live Claude state"
```

---

## Self-review notes
- **Spec coverage:** Phase 1 (branding) = Tasks 1–2. Phase 2 (engine + in-app munu) = Tasks 3–8.
  Overlay (spec Layer 3), permission HUD (Layer 4), polish (Layer 5) are deliberately deferred to
  follow-on plans, as noted in the spec's phased build order.
- **Type consistency:** `ClaudeState` ('idle'|'working'|'asking') from `claudeStatus.ts`;
  `MunuState` adds 'done' in `munuAggregate.ts`; the store maps panes→MunuState. `onStatus`
  signature matches between `useTerminal`, `TerminalView` (spread), and `PaneTree`.
- **SVG import typing:** electron-vite's renderer tsconfig includes Vite client types, which declare
  `*.svg` as `string`. If typecheck complains, add `/// <reference types="vite/client" />` to a
  renderer `env.d.ts` (check it exists first).
```
