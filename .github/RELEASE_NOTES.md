<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__: real usage, agents in munu, search, and a much smoother app

- **Real usage percentages.** The usage pill now shows your real 5-hour and 7-day numbers from Claude itself, not an estimate. Pick what it shows (percent, bar, ring or graph), reset countdown and warning colours in the Usage panel, and pop it out as a floating, resizable, always-on-top widget. Until Claude has sent data, it says "no data yet". Your own Claude settings and status line are never changed.
- **munu sees your agents.** Sub-agents, background agents and team members show up as little munus and in the popup. munu keeps working while they run and only smiles once, after the last one is done.
- **munu is clickable again on Windows.** The overlay no longer inherits the app zoom, so clicks and the popup (pin, size, agents) work. On macOS the popup opens without the little glitch.
- **Quick Open and Find in files.** Find any file by name, or any text in any file, including ignored folders when you ask for them. The index runs off the main thread and stays fast on 200k files.
- **A better file explorer.** Keyboard navigation, multi-select, drag to move, inline create and rename, git badges, sorting and a hidden-files toggle, on a virtualized tree.
- **Much smoother.** Idle CPU on a Mac dropped from about 50% to 12% of one core, typing while Claude streams is about twice as fast, a 50 MB chat opens without a freeze, and a very large paste no longer swallows Enter or Ctrl+C typed right after it. Pane controls no longer cover the close button of Claude's diff panel.
- **Safer search and paths.** Search paths are jailed to the project, and paths pasted into a `cmd` or PowerShell pane are quoted for that shell.

All local and read-only on your own `~/.claude` files. No API, no telemetry.

---

## ⬇️ Download

| Your system | File to download |
|---|---|
| 🍎 **macOS — Apple Silicon** (M1 / M2 / M3 / M4) | **DockTerm-__VER__-macOS-Apple-Silicon.dmg** |
| 🍎 **macOS — Intel** | **DockTerm-__VER__-macOS-Intel.dmg** |
| 🪟 **Windows** 10 / 11 (64-bit) | **DockTerm-__VER__-Windows.exe** |
| 🐧 **Linux** (x86-64) | **DockTerm-__VER__-Linux.AppImage** |

**Not sure which Mac you have?** Apple menu → **About This Mac**. If the chip says *Apple M1/M2/M3/M4…* choose **Apple Silicon**; if it says *Intel* choose **Intel**.

The macOS builds are **signed and notarized by Apple**, so they open normally — no security warning.

---

DockTerm — a terminal-first workspace for Claude Code. No telemetry, no accounts.
