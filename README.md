<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)"  srcset="assets/brand/dockterm-logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/brand/dockterm-logo-light.svg">
    <img alt="DockTerm" src="assets/brand/dockterm-logo.svg" width="440">
  </picture>
</p>

<p align="center">
  <b>Run Claude Code, then go do something else.</b><br>
  A terminal-first workspace for <a href="https://www.anthropic.com/claude-code">Claude Code</a> — keep your real <code>claude</code> session, with diffs, Git, files &amp; MCP one keypress away.<br>
  And <b>munu</b>, a face in your notch, tells you the moment Claude needs you — even in a fullscreen app on another desktop.
</p>

<p align="center">
  <a href="../../releases"><img alt="Download" src="https://img.shields.io/github/v/release/munvard/dockterm?style=for-the-badge&label=Download&labelColor=1e1e1d&color=7c6bff&logo=github&logoColor=white"></a>
  &nbsp;
  <a href="../../releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/munvard/dockterm/total?style=for-the-badge&label=Downloads&labelColor=1e1e1d&color=4ade80&logo=github&logoColor=white"></a>
  &nbsp;
  <a href="../../stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/munvard/dockterm?style=for-the-badge&label=Stars&labelColor=1e1e1d&color=fbbf24&logo=github&logoColor=white"></a>
  &nbsp;
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-7c6bff?style=for-the-badge&labelColor=1e1e1d&logo=opensourceinitiative&logoColor=white"></a>
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-1e1e1d?style=flat-square&logo=apple&logoColor=white">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-1e1e1d?style=flat-square&logo=gitforwindows&logoColor=white">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-1e1e1d?style=flat-square&logo=linux&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-1e1e1d?style=flat-square&logo=electron&logoColor=9FEAF9">
  <img alt="No telemetry" src="https://img.shields.io/badge/no%20telemetry-1e1e1d?style=flat-square&logo=ghostery&logoColor=white">
</p>

<p align="center">
  <img src="docs/screenshots/permission.png" alt="munu catching a Claude permission prompt in the notch" width="900">
</p>
<p align="center"><sub>Claude paused to ask permission — munu caught it in the notch, so you can answer without leaving what you were doing.</sub></p>

---

- 🔔 **munu** — a notch mascot that reads Claude's state from the terminal and surfaces permission prompts, even when you're in another window or a fullscreen app.
- 🔍 **Diff review + safe Git** — see exactly what changed, then stage and commit, without leaving the terminal.
- 🗂️ **Files, editor & MCP, on demand** — a file tree, Monaco editor, image previews, and a read-only MCP view that appear when you ask and vanish when you don't.
- 🪟 **A project per pane** — a grid where each pane is a different repo; the side panels follow whichever you focus.
- 🔒 **Local-only** — no accounts, no telemetry; it never calls an AI of its own.

Running Claude Code means living next to a terminal — alt-tabbing to read a diff, to commit, to check whether it's stuck on a `[y/n]`. DockTerm keeps that terminal central and brings the rest to you, so you can let Claude work and actually step away. Claude Code does the work; DockTerm is the calm window around it.

**It keeps your real `claude` — it doesn't replace it.** Unlike Claude Code GUIs that swap your terminal for a custom chat UI (Claudia/Opcode), DockTerm wraps your actual session and builds views around it. Nothing to relearn, and it stays compatible as Claude Code evolves.

**Why not just iTerm or VS Code?** A terminal alone can't show a highlighted diff of what Claude changed, or let you commit safely without raw `git` gymnastics — and it can't tell you Claude is waiting on you while you're in another window. Opening a full IDE to review three lines breaks the flow. DockTerm sits in between.

## munu

DockTerm reads Claude's state from the terminal output and shows it as **munu**, a small face near your menu bar — in the notch, on a MacBook. At a glance you can tell whether Claude is working, finished, or waiting for a `[y/n]`, even when DockTerm is behind another window. When Claude pauses to ask permission, munu surfaces the prompt so you can answer with one click and never lose your flow. It infers everything from the terminal; it never auto-answers and never calls an API.

<p align="center"><img src="docs/screenshots/fullscreen.png" alt="munu surfacing a Claude permission prompt over a fullscreen video" width="900"></p>
<p align="center"><sub>Go watch something fullscreen — munu floats over it (even on another desktop/Space) and brings Claude's prompt to you, so you never miss it.</sub></p>

<table align="center">
  <tr>
    <td align="center" width="136"><img src="assets/brand/munu.svg"         width="104"></td>
    <td align="center" width="136"><img src="assets/brand/munu-working.svg"  width="104"></td>
    <td align="center" width="136"><img src="assets/brand/munu-asking.svg"   width="104"></td>
    <td align="center" width="136"><img src="assets/brand/munu-happy.svg"    width="104"></td>
    <td align="center" width="136"><img src="assets/brand/munu-sleeping.svg" width="104"></td>
  </tr>
  <tr>
    <td align="center">resting</td>
    <td align="center">working</td>
    <td align="center">needs you</td>
    <td align="center">done</td>
    <td align="center">no project</td>
  </tr>
</table>

It tucks into the notch and slides out on hover, peeks for a few seconds when Claude's state changes, and stays out while Claude needs you. On Windows and Linux it's a small auto-hiding pill at the top of the screen.

## What you get

- **Real terminal** — xterm.js on a native PTY (your real shell). Tabs, splits, grids, true-color, unicode, search, smooth scrolling.
- **Diff review** — see exactly what changed since your last commit, this session, or a pinned checkpoint, and open a side-by-side diff for any file before you trust it.
- **Beginner-safe Git** — grouped status, stage/discard, commit, push/pull, branches, with confirmations that show the exact command they'll run.
- **Files, editor & previews** — file tree, Monaco editor with a save-conflict guard, image and binary previews, drag a file into a terminal to insert its path.
- **MCP & skills** — read-only view of your MCP servers (project, user, claude.ai connectors, and plugin-provided), with secrets masked; browse and scaffold skills.
- **A project per pane** — a grid where each pane is a different repo; focus a pane and the side panels follow it, including a live `cd`.
- **Themes & zoom** — seven themes plus follow-system, and `⌘`/`Ctrl` `+ / − / 0` to scale the whole UI.

#### Review what Claude changed, then commit when you're ready
<p align="center"><img src="docs/screenshots/review.png" alt="Side-by-side diff review with a commit box" width="880"></p>

#### One window, many projects
<p align="center"><img src="docs/screenshots/grid.png" alt="A grid of terminals, each a different project" width="880"></p>

## Install

Download from [Releases](../../releases):

| System | File |
|---|---|
| macOS (Apple Silicon) | `DockTerm-<version>-macOS-Apple-Silicon.dmg` |
| macOS (Intel) | `DockTerm-<version>-macOS-Intel.dmg` |
| Windows 10/11 | `DockTerm-<version>-Windows.exe` |
| Linux (x86-64) | `DockTerm-<version>-Linux.AppImage` |

macOS builds are **signed and notarized**, so they open normally. Windows builds are unsigned for now — if SmartScreen appears, choose *More info → Run anyway*. Installs per-user, no admin.

## Security

DockTerm is built to be trusted with your code:

- `contextIsolation` and `sandbox` are on; production loads over a custom protocol with a strict CSP and no remote content.
- Every IPC channel is an explicit, schema-validated verb with a sender check.
- Filesystem access is jailed to the open project (symlink-safe). Reading `~/.claude` is a separate opt-in.
- Every `git` call runs with `core.hooksPath=`, so a malicious repo's hooks can't execute.
- MCP and skill config is read-only and never executed; secrets are shown as key names only.

More in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

## Build from source

```bash
git clone https://github.com/munvard/dockterm && cd dockterm
npm install
npm run dev        # run with hot reload
npm test           # unit tests (vitest)
npm run build      # production bundles
```

Requires Node 20+. Architecture notes are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

Early but actively developed, and used daily. It's an Electron app, so the download is fairly large. macOS builds are notarized; Windows is unsigned for now. Bugs and rough edges are expected — issues and PRs are welcome.

## License

[MIT](LICENSE). Built with Electron, xterm.js, Monaco, and simple-git.
