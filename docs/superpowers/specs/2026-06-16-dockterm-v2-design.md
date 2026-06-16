# DockTerm V2 — Sessions, Themes & Native Soul (Design Spec)

**Status:** approved direction, 2026-06-16
**Supersedes nothing; extends V1** (`docs/ULTRAPLAN.md`, ADR-001..008).

## 1. Goal

Evolve DockTerm from a single-terminal, single-project workspace into a
**multi-window, multi-project tiling terminal workspace** for running many Claude
Code sessions at once — with a cohesive theme system and a premium, native-feeling
macOS shell. Identity is unchanged: terminal-first, local-only, **no telemetry,
no accounts, no cloud, no stored tokens**; DockTerm reads config, never runs MCP
servers.

## 2. Mental model

```
App
└── Window(s)              ⌘N opens more; each window is fully independent
    └── Tab(s)             +/× · rename · reorder · ⌘1–9
        └── Pane layout    recursive split tree → ANY grid (2×2, 3×2, …)
            └── Terminal   one shell, with its OWN cwd / project
```

This single structure delivers every requested capability:
- **Tabs**: a tab strip with new/close/rename/reorder.
- **Splits / grids**: each tab's content is a recursive split tree, so any grid
  (e.g. 3 columns × 2 rows = 6 terminals) is expressible; window maximized = the
  "6 terminals fullscreen" case.
- **Separate windows**: ⌘N spawns an independent window with its own tabs/panes.
- **Mixed projects**: each pane/terminal carries its own cwd, so a single grid can
  host terminals from 6 different projects. The side dock retargets to whichever
  pane is focused.

## 3. Core architectural change: terminals decoupled from "the project"

V1 hard-wires the whole UI to one global project root
(`projectContext.getProjectRoot()`), which every project-scoped service reads.
V2 makes **terminal sessions first-class** and makes project context **a
per-call parameter** so different panes/windows can target different projects
simultaneously.

### 3.1 Sessions (main)
- A session is `{ id, cwd, shell, title, pty, flow, ownerWebContentsId }`.
- `pty:create({ cwd, cols, rows })` validates `cwd` (falls back to `homedir()`),
  spawns the shell there, binds the session to the **requesting window's
  webContents id**, and routes `pty:data`/`pty:exit` only to that webContents.
- When a window closes, all its sessions are killed.
- Flow-control (`PtyFlow`) and batching are unchanged, per session.

### 3.2 Per-call project root (main)
- New pure helper `resolveProjectRoot(cwd)`: walk up from `cwd` to the nearest
  `.git` (else the first dir containing a project manifest, else `cwd` itself).
- Every project-scoped IPC handler takes an explicit `root` (no global state):
  files (`tree`/`read`/`write`), git (all), project `inspect`/`info`, MCP/skills
  `read`. The path-jail validates and confines each call **within that `root`**.
- `projectContext` (global mutable root) is removed. Path-jail becomes a pure
  `jail(root, relPath)` used by each handler with the supplied root.

### 3.3 Watcher follows focus (main, per window)
- One chokidar watcher **per window**, targeting the **focused pane's project
  root**. On focus change the renderer calls `watch:retarget({ root })`; the
  watcher closes and re-opens on the new root (cheap — V1 ignores already proved
  the scan is sub-second with the existing ignore list). `fs:watch` events go to
  that window only. Watching every pane's project at once is explicitly **not**
  done (avoids the multi-project fan-out cost).

### 3.4 Window management (main)
- `windowService` creates/tracks windows (used for the first window and ⌘N).
- Each window loads the same renderer and owns its own layout state.
- On quit / window-all-closed: kill that window's sessions, stop its watcher.

## 4. Renderer architecture

### 4.1 Layout data model (per window)
```ts
type PaneNode =
  | { type: 'leaf'; id: string; sessionId: string | null; cwd: string;
      projectRoot: string; title: string }
  | { type: 'split'; id: string; dir: 'row' | 'col';
      sizes: number[]; children: PaneNode[] }   // n-ary; sizes are %

interface Tab { id: string; title: string; layout: PaneNode; focusedLeafId: string }
interface Workspace { tabs: Tab[]; activeTabId: string }
```
- N-ary splits (not just binary) make grid presets and resizing natural and map
  1:1 to `react-resizable-panels` `PanelGroup`/`Panel` (already a dependency).
- Layout mutations live in a **pure module** `layout.ts` (split, closeLeaf with
  reflow, setGridPreset(rows,cols), focus navigation, resize) → fully unit-tested.

### 4.2 State
- `useWorkspaceStore` (zustand): the per-window `Workspace`, focus, and all
  layout actions. Replaces the single-terminal assumptions in `Shell`.
- `useActiveProject` selector: the focused leaf's `projectRoot` — the value the
  dock panels read and pass into IPC. Changing focus re-points the dock.

### 4.3 Components
- `TabStrip` — tabs (rename on double-click, reorder by drag, close ×, activity
  dot) + new-tab `+`.
- `PaneTree` — recursive: `split` → `PanelGroup` with resize handles; `leaf` →
  `TerminalPane`.
- `TerminalPane` — one `useTerminal(session)`, a slim header (running-process
  title + split/close buttons), focus ring; click/focus sets `focusedLeafId`.
- `Shell` (reworked) — TabStrip + active tab's `PaneTree` + the dock, where the
  dock now reads `useActiveProject()`.
- Stores that hit project-scoped IPC (`useGitStore`, `useEditorStore`, file tree,
  info, mcp, skills) take a `root` argument sourced from `useActiveProject`.

### 4.4 `useTerminal`
- Parameterized by `{ sessionId?, cwd }`; creates one PTY per pane via
  `pty:create({ cwd, … })`. Otherwise the xterm wiring is V1's (WebGL→DOM
  fallback, flow-control acks, fit/resize).

## 5. Theme system (Milestone E)

- A theme is data: `{ id, name, appearance: 'dark'|'light', ui: Record<cssVar,
  color>, terminal: XtermTheme, monaco: MonacoThemeDef }`.
- Applying a theme = set CSS custom properties on `:root`, set the xterm theme on
  every live terminal, and define/select the Monaco theme. One switch restyles
  chrome + panels + terminals + editor together.
- Curated built-ins (dark+light where applicable): **DockTerm Dark (signature)**,
  **DockTerm Light**, Tokyo Night, Catppuccin (Mocha/Latte), Nord, Rosé Pine,
  Solarized (Dark/Light), GitHub (Dark/Light).
- **Follow macOS appearance**: `nativeTheme` reports + emits changes; "Auto"
  picks the dark/light variant of the chosen theme.
- Picker in the command palette and Settings, with **live preview** (apply on
  hover/selection, persist on confirm). Selection persisted in settings.
- YAGNI: no user-authored theme JSON in V2 (curated set first).

## 6. Native macOS polish (Milestone F)

- **Vibrancy**: `vibrancy: 'under-window'` + `visualEffectState: 'active'`,
  transparent window background, translucent panels for native depth (macOS only;
  Windows/Linux keep the solid themed background).
- **Title bar**: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition` so the
  tab strip sits at the very top (Warp/iTerm feel) with traffic-lights inset;
  custom draggable region. Windows/Linux get a clean custom top bar.
- **Motion**: CSS-only spring/ease transitions for tab switches, pane
  open/close, panel slide. No animation library (keep the bundle lean).
- **Typography**: spacing/scale pass; bundle one high-quality mono fallback.

## 7. Menu-bar + global hotkey (Milestone G)

- `Tray` icon (macOS menu bar; also Windows tray): show/hide the app, "New
  terminal", "New window", Quit.
- `globalShortcut` to toggle show/hide and to spawn a fresh terminal from
  anywhere. The full Quake-style slide-down overlay terminal is **deferred** to a
  later iteration (noted as a future option), keeping G small.

## 8. IPC contract changes (`src/shared/ipc.ts`)

- `pty:create` payload `{ cwd, cols, rows }` → `{ sessionId, shell, cwd }`
  (drops `kind`). `pty:write/resize/ack/kill` unchanged (keyed by sessionId).
  Events `pty:data`/`pty:exit` carry `sessionId` (already do).
- Project-scoped channels gain `root`: `files:tree|read|write`, `git:*`,
  `project:inspect|info`, `mcp:read`, `skills:read`.
- New: `window:new`, `watch:retarget({ root })`, `workspace:save`/`workspace:load`
  (per-window layout persistence), `theme:get|set`, `system:appearance` (event).
- All channels remain in the runtime allow-lists; renderer stays sandboxed,
  `contextIsolation` on, no node integration.

## 9. Persistence & migration

- Settings (`dockterm-config.json`) gains: `theme` (id + "auto" flag), and
  per-window `workspaces` (serialized tabs/panes with each leaf's `cwd`/title —
  **not** scrollback). Window bounds saved per window.
- On launch, restore windows → tabs → panes, respawning shells in saved cwds.
  Scrollback is **not** restored (shells restart clean).
- Zod schema migrates V1 configs forward via defaults; a V1 single terminal maps
  to one window → one tab → one leaf pane.

## 10. Security (unchanged guarantees)

- `contextIsolation: true`, `sandbox: true`, no node integration, no remote
  content; CSP intact. Fuses still flipped in `afterPack`.
- Path-jail enforced **per call** against the supplied `root` (realpath, prefix
  check, case-insensitive on Windows). Multiple roots are allowed only because the
  user explicitly opened/`cd`'d them; no broadening of arbitrary FS access.
- MCP/skills secret masking unchanged; DockTerm still never executes MCP servers.

## 11. Testing strategy

- **Pure, unit-tested:** `layout.ts` (split/close/reflow/grid-preset/focus-nav/
  resize), `resolveProjectRoot`, per-root `jail`, theme application mapping,
  `PtyFlow` (existing). These hold the real complexity and are framework-free.
- **Light integration:** session routing to the correct webContents (mock),
  watcher retarget, config migration.
- Keep `typecheck` + `vitest` green at every milestone; CI unchanged.

## 12. Build order (milestones, each shippable)

| # | Milestone | Outcome |
|---|---|---|
| **A** | Sessions foundation | PTYs decoupled from project; per-call `root`; watcher per window. No visible change. |
| **B** | Tabs | Tab strip (+/×/rename/reorder/activity), ⌘T/⌘W/⌘1–9, layout persistence/restore (single-pane tabs). |
| **C** | Tiling grid | Recursive splits, drag-resize, grid presets (2×2/3×2), dock follows focused pane. |
| **D** | Multiple windows | ⌘N new window, independent layouts, per-window sessions/watcher. |
| **E** | Theme system | Cohesive curated themes, light/dark, follow-system, live preview. |
| **F** | Native macOS polish | Vibrancy, hidden-inset title bar, motion, typography, bundled font. |
| **G** | Menu-bar + global hotkey | Tray + shortcut to show/hide & spawn terminals. |

**Plans are written per phase**, not all at once: A+B together first (the
foundation + first visible feature), then C, D, E, F, G as each lands — so
detailed task plans for later milestones are written against real, working code
rather than assumptions.

## 13. Non-goals (V2)

- No tmux-style session sharing/attach across machines; no remote/SSH.
- No drag-a-terminal-between-windows (possible later).
- No user-authored theme files; no Quake drop-down overlay (G is tray+hotkey only).
- No auto-update, telemetry, accounts, or cloud — unchanged product guarantee.

## 14. Resolved decisions

- Tabs **and** splits **and** multiple windows (all approved).
- Splits are **n-ary recursive** (enables arbitrary grids + presets).
- The dock **follows the focused pane's project** (makes mixed-project grids
  coherent).
- Theme set: **curated popular + signature**, light/dark, follow-system.
- "Summon/hide": **tray + global hotkey** (lighter); Quake overlay deferred.
