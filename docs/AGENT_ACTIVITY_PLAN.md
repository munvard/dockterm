# Plan — Live Agent Activity ("the swarm")

> Status: **SHIPPED in v0.26.0.** This was the pre-implementation plan; a couple
> of details changed once the real transcript schema was verified against live
> data — they're recorded here so the doc matches what actually ships:
>
> - **Spawn tool name is `Agent`** (older builds: `Task`); the parser accepts both.
> - **Sub-agents do not stream their internal steps** into the parent transcript
>   (no `isSidechain` entries), so the per-agent view is a **live status →
>   final-result card**, not a streaming "mini-terminal". Count, type, description,
>   elapsed, done/failed, duration, and the final result text are all reliable.
> - Channels shipped as **`activity:get`** (invoke) + **`activity:changed`** (event).
> - The overlay swarm reveals as a **peek on agent-count change** (then tucks),
>   and the overlay window sets `backgroundThrottling: false` so it reacts while
>   DockTerm is in the background.

Decisions locked in brainstorming: **build everything at once · global, grouped
by project · full creature swarm · all surfaces.**

---

## 1. Concept & the honest engineering reality

Claude Code writes a full JSONL transcript per session under
`~/.claude/projects/<slug>/*.jsonl`. DockTerm's `usageService` **already tails
these files** (byte-offset incremental reads, dedup, retention, 5 s poll,
`usage:changed` broadcast to every window). This feature is a **sibling service**
that parses *different lines* from the same files. ~70 % of the plumbing exists.

What the transcript gives us, and how reliable each is:

| Signal | Source | Reliability |
|---|---|---|
| Agent **count / type / description / start / end / duration / ok-fail** | main-thread `Task` `tool_use` + matching `tool_result` (by `tool_use_id`) | **Solid** — no ambiguity |
| Parent→child **tree** | the assistant message `uuid` that holds the `Task` calls | **Solid** |
| Per-agent **live output** (mini-terminal) | `isSidechain:true` entries, grouped by chain, attributed to an agent | **Best-effort** — see §7 |
| Per-agent **tokens / tool count** | `message.usage` on sidechain assistant lines | Good |

**Three caveats baked into the design (not hidden):**
1. **Granularity is per-completed-message, not per-token.** A line lands in the
   JSONL when a message/tool-call *finishes*. The mini-terminal is therefore a
   live **activity log** (one entry per tool call / text block), not a streaming
   TTY. We set that expectation in the UI copy.
2. **Concurrent-agent attribution is best-effort.** Sequential sub-agents thread
   perfectly; truly-parallel sub-agents in one turn are attributed by chain +
   temporal adjacency and may occasionally mis-thread a line. Count/type/timing
   stay correct regardless.
3. **Reading conversation content** (for the mini-terminals) is a step beyond
   `usageService`'s advertised "token counts only, never content." It is the
   user's own conversation, on their machine, shown only locally, held only in a
   capped in-memory tail, **never persisted** — and gated behind an opt-in
   `streamOutput` setting.

**Schema risk & mitigation.** The user's own transcripts contain almost no
sub-agent runs, so we cannot fully verify the live schema from existing data.
Mitigation: **fixture-first TDD** against the documented shape with **tolerant
parsing** (all sub-agent fields optional), plus a **Step 0** that captures a real
multi-agent transcript and locks the parser to reality before UI work.

---

## 2. Scope — files to create / modify (real paths)

### Create
- `src/main/services/agentActivityService.ts` — tail + pure reducer + broadcast + `getAgentActivity()` + watcher start/stop.
- `src/renderer/src/state/useAgentStore.ts` — zustand store (mirror `useUsageStore`).
- `src/renderer/src/components/agents/AgentPill.tsx` — top-bar live count (mirror `UsagePill`).
- `src/renderer/src/components/agents/ActivityPanel.tsx` — the dock panel (groups, tree, cards, timeline).
- `src/renderer/src/components/agents/AgentMiniTerminal.tsx` — read-only output scroller.
- `src/renderer/src/components/agents/agentCreature.ts` — `subagent_type → mascot/character + icon` mapping (cute).
- `src/renderer/overlay/Swarm.tsx` — the creature swarm under munu (overlay renderer).
- `tests/unit/agentActivity.test.ts` — pure-logic tests.

### Modify
- `src/shared/types.ts` — `LiveAgent`, `AgentActivity`, `AgentPhase`, `AgentActivitySettings`; add `'activity'` to `PanelId`; add `agentActivity` to `Settings`.
- `src/shared/ipc.ts` — `agents:get` (InvokeChannels + `INVOKE_CHANNELS`), `agents:changed` (EventChannels + `EVENT_CHANNELS`), add `'agentActivity'` to the `SettingsPatch` `Pick<>`.
- `src/main/ipc/handlers/app.ts` — `reg('agents:get', z.void(), async () => ok(await getAgentActivity()))`.
- `src/main/index.ts` — `startAgentWatcher()` beside `startUsageWatcher()` (line ~39).
- `src/main/services/settingsService.ts` — `agentActivity` zod section, every leaf `.default()`; mirror in `settingsPatchSchema`.
- `src/renderer/src/components/layout/panels.ts` — `{ id: 'activity', label: 'Activity', icon: <Workflow/Radar> }`.
- `src/renderer/src/components/layout/TopBarTools.tsx` — render `<AgentPill/>` (participates in overflow logic).
- The Dock panel switch (wherever `PanelId` is rendered — `components/layout/Dock*.tsx`) — render `ActivityPanel`.
- `src/renderer/overlay/main.tsx` — mount `<Swarm/>`; fold its size into the existing `measure()` → `munu:resize`.
- `src/renderer/src/components/settings/*` — a settings section with the toggles.
- `src/renderer/src/styles/components.css` (+ overlay styles) — pill, panel, mini-terminal, creature animations.
- Docs: `docs/ARCHITECTURE.md` (new service + channels), `docs/ROADMAP.md` (move to Shipped).

---

## 3. Data model (`src/shared/types.ts`)

```ts
export type AgentPhase = 'spawning' | 'running' | 'finishing' | 'done' | 'failed'

export interface LiveAgent {
  id: string                 // Task tool_use id (toolu_…) — stable & unique
  parentMsgId: string | null // assistant uuid that spawned it (tree grouping)
  type: string               // subagent_type, e.g. 'Explore'
  description: string         // input.description (chip label)
  project: string            // cwd
  projectLabel: string       // folder name (reuse usageService labeling)
  sessionId: string          // transcript file stem
  startedAt: number
  endedAt: number | null
  phase: AgentPhase
  tokens: number             // accumulated output tokens (sidechain usage)
  toolCount: number          // # tool calls observed
  lastLine: string | null    // newest activity line (for the chip)
  tail: string[]             // capped recent lines (mini-terminal); [] if streamOutput off
  ok: boolean | null
  resultSummary: string | null // one-line final result on completion
}

export interface AgentActivity {
  updatedAt: number
  agents: LiveAgent[]        // active + recently-finished (within RETAIN_MS)
  activeCount: number
  byProject: { project: string; label: string; count: number }[]
}

export interface AgentActivitySettings {
  enabled: boolean        // default true
  streamOutput: boolean   // read message content for mini-terminals; default true
  swarm: boolean          // creatures under munu overlay; default true
  pill: boolean           // top-bar count pill; default true
  sounds: boolean         // chime when agents finish; default true
  notifications: boolean  // desktop notify when all finish & app unfocused; default true
}
```

---

## 4. IPC contract changes (`src/shared/ipc.ts`)

```ts
// InvokeChannels
'agents:get': (req: void) => Result<AgentActivity>
// EventChannels
'agents:changed': AgentActivity
```
- Add `'agents:get'` to `INVOKE_CHANNELS`, `'agents:changed'` to `EVENT_CHANNELS` (hand-synced allowlists — required or rejected at runtime).
- Add `'agentActivity'` to the `SettingsPatch` `Pick<Settings, …>`.
- Handler (in `handlers/app.ts`, beside `usage:get`):
  `reg('agents:get', z.void(), async () => ok(await getAgentActivity()))`
- `import { startAgentWatcher } from './services/agentActivityService'` in `index.ts`; call it next to `startUsageWatcher()`.

---

## 5. Service design (`agentActivityService.ts`)

- **Own offset map**, mirroring `usageService` (kept separate so the stable usage
  path is never destabilized; the minor double-read of freshly-appended bytes is
  negligible. A later refactor can extract a shared `transcriptTail` core.)
- **Reducer (pure, exported for tests):** fold JSONL lines into a
  `Map<toolUseId, LiveAgent>`:
  - assistant line with `content[].type==='tool_use' && name==='Task'` → create agent (`spawning`→`running`), record type/description/parentMsgId/cwd/start.
  - `isSidechain:true` line attributed to an agent (§7) → push to `tail` (cap ~50), bump `toolCount`, add `message.usage.output_tokens`, set `lastLine`; flip `spawning`→`running`.
  - user line with `content[].type==='tool_result' && tool_use_id===id` → `endedAt`, `phase` `done`/`failed`, `ok`, `resultSummary` (first ~120 chars of result text).
  - `streamOutput===false` → never read/keep content (`tail=[]`, `lastLine=null`, `resultSummary=null`); metadata still flows.
- **Live model:** active agents + finished agents kept for `RETAIN_MS` (~30 s) then dropped.
- **Adaptive poll:** ~1 s while any agent is active, ~4–5 s when idle (live feel without constant churn). Honor `enabled` (skip all I/O when off — same guard as usage).
- **Broadcast** `agents:changed` to all windows on change, throttled ≤ ~4/s. `getAgentActivity()` for initial fetch.
- **Smart reuse:** on "all agents finished" transition → optional `Notification` (respect `notifications` + app-unfocused, exactly like `munuService.maybeNotify`); `powerSaveBlocker` keep-awake while active (mirror `applyKeepAwake`).

---

## 6. Renderer data flow

```
agentActivityService (main, tails JSONL)
  → 'agents:changed' broadcast ──► every window incl. overlay
useAgentStore (renderer)  ── agents:get on mount, then on('agents:changed')
  ├─ AgentPill (TopBarTools)      glance: active count, hidden when 0
  ├─ ActivityPanel (Dock)         detail: by-project groups, parent→child tree,
  │                               per-agent card + AgentMiniTerminal, recent/timeline
overlay/main.tsx → Swarm          creatures per active agent; size folds into measure()→munu:resize
```
No new munu coupling: the overlay already receives broadcast events through its
preload bridge, so `agents:changed` reaches it the same way `usage:changed` does.

**Cute layer:** `agentCreature.ts` maps `subagent_type` → a character
(munu/nvurd/guru/adanana) or per-type icon + friendly name. Per-phase CSS:
`spawning` hatch, `running` wiggle, `done` hop+fade, `failed` wilt. The mini-terminal
header labels granularity ("live activity — updates per step").

---

## 7. Sidechain attribution (the hard part)

Live output lines (`isSidechain:true`) are not stamped with the `Task` id. We
associate them by:
1. **Chain grouping:** track sidechain `uuid`→`parentUuid`; entries sharing a
   chain root belong to one agent.
2. **Anchor to a Task:** bind a chain root to the still-running agent in the same
   session whose `Task` `tool_use` most-recently precedes the chain's first entry.
3. **Fallback:** if ambiguous, attribute to the most-recently-started running
   agent in that session.

Sequential sub-agents → exact. Parallel → best-effort (documented in §1). All
**count/type/timing/tree** data is independent of this and always correct.

---

## 8. Security & principles

- **Read-only**, same files `usageService` already reads; no writes, no execution.
- Reading `~/.claude/**` lives in a dedicated main-process service — the
  established `usageService` precedent. `pathJail` governs *project* fs handlers
  and is unaffected (not a bypass).
- **No git** → no `gitInvoke` needed. **No API, no telemetry, no network.**
- Conversation content (mini-terminals) is **opt-in** (`streamOutput`),
  **in-memory + capped**, **never persisted**, shown only locally. We do not
  `secretMask` transcript content (that's for config key/values); we minimize by
  capping the tail and never writing it anywhere.
- `contextIsolation` + `sandbox` unchanged; renderer still only via `window.dockterm`.
- Fits the product: on-demand panel + opt-in overlay, calm "ambient awareness,"
  not IDE-creep. Moves a Roadmap-shaped item into Shipped.

---

## 9. Tests (`tests/unit/agentActivity.test.ts`, pure)

Fixture-driven (synthetic JSONL mirroring the documented schema + a captured real
sample from Step 0):
- Single agent: Task → sidechains → tool_result ⇒ one agent, correct type/desc/phase
  transitions/duration/`ok`.
- Two concurrent agents interleaved ⇒ both tracked; attribution per §7.
- `tool_result` failure ⇒ `phase:'failed'`, `ok:false`.
- `RETAIN_MS` ⇒ finished agents drop after the window.
- `tail` cap ⇒ never exceeds N.
- `streamOutput:false` ⇒ `tail`/`lastLine`/`resultSummary` empty, metadata intact.
- Non-agent lines (plain usage/user) ⇒ ignored.
- Malformed JSON ⇒ skipped, never throws.
- `byProject` grouping + labeling.
- Settings forward-migration: `agentActivity` defaults fill from a partial config.

---

## 10. Build order (each step keeps `typecheck && test && build` green)

0. **Capture a real sample** — run a multi-sub-agent task, snapshot the JSONL
   lines to a fixture; lock the parser to reality. (Proceed tolerant-parsing if
   unavailable.)
1. **Types + pure reducer + tests** — no UI. typecheck+test green.
2. **Service + IPC + settings** — `agentActivityService`, channels, handler,
   `index.ts` start, settings schema/patch/Pick. typecheck+test+build green.
3. **Store + glance + detail (plain)** — `useAgentStore`, `AgentPill`,
   `ActivityPanel`, `AgentMiniTerminal`, panel registration + Dock render.
   Verify against a real agent run.
4. **Cute** — `agentCreature` mapping, per-phase animations, overlay `Swarm`,
   overlay sizing.
5. **Smart** — sounds / notifications / keep-awake + settings toggles.
6. **Polish + docs + release** — ARCHITECTURE + ROADMAP, memory file, version
   bump + RELEASE_NOTES, tag.

---

## 11. Acceptance criteria

- **No agents:** pill hidden, panel empty-state, swarm empty, no extra perf cost.
- **Spawn N:** within ~1–2 s the pill shows N; panel lists N grouped by project
  with type + description + elapsed + tokens; swarm shows N creatures.
- **While running:** each mini-terminal appends activity as steps complete.
- **On finish:** card shows done + duration + result summary, celebrates, settles
  into recent/timeline; pill decrements; creature hops + poofs.
- **Tree:** an orchestrator's children nest correctly.
- **`streamOutput` off:** no content read/shown; metadata still works.
- **Feature off:** nothing read, nothing shown.
- **Green:** typecheck + test + build pass; new unit tests pass; no usage/munu
  regressions.

---

## 12. Risks (called out, not buried)

1. Schema uncertainty (sparse real data) → fixture-first + tolerant parse + Step 0.
2. Live granularity = per-completed-step, not per-token → UI sets expectation.
3. Concurrent-agent attribution best-effort → §7.
4. Per-pane attribution deferred (global-by-project chosen).
5. Reading content is a posture step beyond usage → opt-in, in-memory, never persisted.
6. Overlay swarm sizing must respect existing Linux/Wayland repin + work-area clamps.
