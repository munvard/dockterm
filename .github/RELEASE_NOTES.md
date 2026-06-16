<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🧭 What's new in v0.6.0 — the dock follows your terminal

- **Files & Git now follow the focused terminal's *live* directory.** With shell integration (on by default), the side panels track where the shell actually is as you `cd` around — focus a pane that's in `roast-me` and you see roast-me's files; focus one in `GlowAI-main` and it switches. Works per-pane, so a grid of different projects "just works." Toggle it in **Settings → Terminal** if you prefer.
- Under the hood: zsh/bash/PowerShell get a tiny OSC 7 hook (the same technique VS Code uses) that only sources *your own* dotfiles — no network, no secrets — with a clean fallback for other shells.

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
