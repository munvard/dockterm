<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="assets/brand/dockterm-logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/dockterm-logo-light.svg">
    <img alt="DockTerm" src="assets/brand/dockterm-logo.svg" width="420">
  </picture>
</p>

<p align="center">
  the calm workspace for Claude Code — your terminal, with a face
</p>

<p align="center">
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-7c6bff?style=flat-square"></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-1a1a21?style=flat-square">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-signed%20%26%20notarized-4ade80?style=flat-square">
  <img alt="built for Claude Code" src="https://img.shields.io/badge/built%20for-Claude%20Code-7c6bff?style=flat-square">
</p>

---

## Meet munu

**munu is the mini DockTerm — the workspace that woke up.** It sits on the dark terminal tile, watches your files, git, and what Claude Code is doing, and never calls an AI of its own. Its face just mirrors the state — so a glance tells you everything.

<table align="center">
  <tr>
    <td align="center" width="130"><img src="assets/brand/munu.svg"         width="72"></td>
    <td align="center" width="130"><img src="assets/brand/munu-happy.svg"    width="72"></td>
    <td align="center" width="130"><img src="assets/brand/munu-working.svg"  width="72"></td>
    <td align="center" width="130"><img src="assets/brand/munu-sleeping.svg" width="72"></td>
    <td align="center" width="130"><img src="assets/brand/munu-asking.svg"   width="72"></td>
  </tr>
  <tr>
    <td align="center"><b>resting</b><br><sub>idle / ready</sub></td>
    <td align="center"><b>happy</b><br><sub>done / clean</sub></td>
    <td align="center"><b>working</b><br><sub>busy / running</sub></td>
    <td align="center"><b>sleeping</b><br><sub>no project</sub></td>
    <td align="center"><b>asking</b><br><sub>needs your <code>[y/n]</code></sub></td>
  </tr>
</table>

> **asking** is the important one: when Claude Code pauses to request permission (run a command, edit a file), munu raises a brow and shows `[y/n]` — on a floating pill that stays visible even over other apps. It never auto-approves; the decision is always yours.

---

> **DockTerm is terminal-first. The terminal stays central. Panels only appear when you need them.**

---

## What is DockTerm?

You run Claude Code in a terminal. It edits files, runs commands, changes your repo — and you keep alt-tabbing to an editor just to *see* what happened, to a Git client to review and commit, to a file browser to poke around.

DockTerm is the workspace that was missing. A real terminal stays the hero of the screen — you run `claude` in it, exactly like you do today. When Claude changes things, DockTerm lights up what changed, lets you open a **diff**, **stage**, and **commit** safely, preview **images and other files**, and shows your **MCP servers** and **skills** honestly — all without leaving the window, and without DockTerm ever calling an AI API of its own.

It is **not** an IDE, and it does not try to be. There is no LSP, no extension marketplace, no AI chat. The terminal is never subordinate to a panel.

## Who is it for?

Developers who live in the terminal, use Claude Code, and want quick visual control over files, diffs, Git, and Claude's MCP/skills configuration — often across **several projects at once** — without booting a full IDE or trusting a cloud service with their code.

## Core features

| | |
|---|---|
| **Real terminal** | xterm.js + a native PTY (your real shell). Run `claude` here. True-color, unicode, search, copy/paste, WebGL-accelerated. |
| **Tabs, splits & grids** | Open many terminals as tabs, split any pane right/down, or snap a tab into a **2×2 / 3×2 / 3×3 grid** in one click. Building a grid keeps your running shells alive. |
| **Multiple windows & projects** | Each window is one project (Cursor-style welcome on `⌘N`). Or run a grid where **every pane is a different project** — focus a pane and the dock follows it. |
| **Dock follows your `cd`** | With shell integration, the Files/Git panels track the focused terminal's **live directory** as you `cd` around — not just where it started. |
| **File tree + editor** | Monaco editor with tabs, dirty indicators, and a save-with-conflict guard. Drag a file onto a terminal to insert its path. |
| **Image & file preview** | Click a PNG/JPG/SVG/GIF and it opens in an **image viewer** (fit / zoom); binaries show a card with *Reveal* / *Open externally* — no more garbled text. |
| **Beginner-safe Git** | Grouped status, stage/unstage/discard, commit, push/pull with publish-branch flow, branches — with plain-language hints and confirmations on destructive actions. |
| **Diff review + checkpoints** | See what changed since your last commit, this session, or a pinned **checkpoint**; open a side-by-side diff for any file. |
| **MCP panel** | Read-only view of your configured MCP servers, with secrets masked. |
| **Skills panel** | Browse Claude Code skills & commands; scaffold new ones from templates. |
| **Themes** | 7 curated themes (DockTerm Dark/Light, Tokyo Night, Catppuccin Mocha, Nord, Rosé Pine, GitHub Light) plus **Auto / follow-system**. One switch restyles the whole app *and* every terminal. |
| **Comfortable & scalable** | Roomy by default; zoom the entire UI (chrome, terminals, editor) with **⌘+ / ⌘− / ⌘0**, remembered across launches. |
| **Menu-bar + global hotkey** | A tray/menu-bar item and a global show/hide hotkey (`⌃⇧\``) to summon DockTerm from anywhere. |
| **Command palette** | `⌘/Ctrl+Shift+P` for everything, with platform-correct shortcuts. |

## The Claude Code workflow

1. Open a project. The terminal starts in its directory.
2. Run `claude` and let it work.
3. As files change, the top bar shows **`N changed`** and the tree badges update.
4. Open **Review** (or **Source Control**), click a file → read the **diff**.
5. Stage what you trust, write a message, **Commit**. Push when ready.

Need to juggle several repos? Split the tab into a grid and point each pane at a different project — focus one and the Files/Git panels snap to *that* project.

DockTerm watches the filesystem and Git only — it never reads your prompts, never calls an API, and never sends anything anywhere.

![Review a diff before committing](docs/screenshots/review.png)

## MCP & Skills visibility

DockTerm parses your Claude Code config **read-only** and **never executes anything**:

- Project `.mcp.json` (and project-scope `~/.claude.json` entries) are shown by default; user-scope config only after you opt in.
- Every `env` / `header` value is masked to its **key name**; URLs are shown **host-only** (query tokens stripped).
- A trust warning is always present: *only use MCP servers you trust — external content can carry prompt-injection risk.*

![MCP panel with secrets masked](docs/screenshots/mcp.png)

## Git safety

Beginner Git Mode is on by default: short explanations of staged/unstaged/push/branch, and every destructive action shows a confirmation **with the exact command it will run**. Force push is only ever `--force-with-lease`; hard reset and unmerged-branch deletion simply aren't in the UI — that's the terminal's job.

![Beginner-safe Git panel](docs/screenshots/git.png)

## Installation

Download from [**Releases**](../../releases) and pick the file for your system:

| Your system | File |
|---|---|
| 🍎 macOS — Apple Silicon (M1–M4) | `DockTerm-<version>-macOS-Apple-Silicon.dmg` |
| 🍎 macOS — Intel | `DockTerm-<version>-macOS-Intel.dmg` |
| 🪟 Windows 10/11 (64-bit) | `DockTerm-<version>-Windows.exe` |
| 🐧 Linux (x86-64) | `DockTerm-<version>-Linux.AppImage` |

**macOS builds are signed and notarized by Apple — they open normally, no Gatekeeper bypass needed.**
**Windows** is currently unsigned: if SmartScreen appears, choose **More info → Run anyway**. Installs per-user (no admin required).

## Development

Requires Node 20+ (a C++ toolchain is only needed if your platform lacks a node-pty prebuild; Windows and macOS ship prebuilds).

```bash
git clone https://github.com/munvard/dockterm
cd dockterm
npm install
npm run dev          # launch the app with HMR
npm run typecheck    # strict TypeScript, no emit
npm test             # unit tests (Vitest)
npm run build        # production bundles
npm run package      # build an installer for your OS
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the architecture tour and platform notes.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; production loads over a custom `app://` protocol with a strict CSP and no remote content.
- Every IPC channel is an explicit verb, validated with zod, with a sender check. No generic dispatcher.
- Filesystem access is jailed to the open project (symlink-safe, case-insensitive on Windows). Reading user-scope `~/.claude` is a separate, opt-in capability.
- Every `git` invocation runs with `core.hooksPath=` so a malicious repo's hooks can never execute.
- Shell integration (directory tracking) only ever *sources your own* dotfiles and adds an OSC 7 emitter — no network, no secrets — and can be turned off in Settings.
- "Run script" buttons **paste into the mini terminal** — visible execution, never a hidden `exec`.
- The telemetry code does not exist.

Full details: [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Roadmap

Shipped: terminal + mini terminal, tabs, splits & grids, multiple windows, per-pane projects with a dock that follows the focused terminal's live directory, files + Monaco editor, image/binary preview, drag-to-terminal, beginner-safe Git, diff review + checkpoints, MCP & skills panels, command palette, 7 themes + auto, UI zoom, menu-bar + global hotkey, and signed/notarized macOS builds. What's next (MCP health checks, live tool lists, a Quake-style drop-down terminal, per-project profiles) lives in [docs/ROADMAP.md](docs/ROADMAP.md).

## Status

**Actively developed and used daily.** The core is real, tested, and shipping regularly; macOS builds are notarized. It is still focused, opinionated software — **not** a replacement for iTerm or Cursor, with **no** AI calls, **no** accounts, and **no** cloud. Bugs and rough edges happen — please file them.

## Contributing

Issues and PRs welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Security reports: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © DockTerm contributors. Built with Electron, xterm.js, Monaco, and simple-git.
