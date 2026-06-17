<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🛟 What's new in v0.10.3 — new theme, MCP fix, freeze fix & the Dynamic Island

- **New default theme: "DockTerm Graphite"** — a softer, warmer dark (`#1e1e1d`) instead of the near-black. It's the new default; pick any other in **Settings → Appearance**.
- **Your MCP servers actually show up now.** The MCP panel used to only see classic `mcpServers` entries, so if your servers are **claude.ai connectors** (Gmail, Drive, Canva…) or come from **plugins**, it said "none." It now surfaces those too (turn on *Include servers from ~/.claude.json*).
- **Fixed a freeze when opening a big non-git folder.** Opening something huge (like your whole home directory) made the file-watcher try to track *millions* of files and locked up the window. It now never recursively watches the home directory or filesystem roots, and caps watch depth — open anything you like, instantly.
- **Smoother, comfier terminal** — smooth wheel scrolling, a calmer inactive cursor, a bit more line height and padding.
- **munu is now a Dynamic Island.** It tucks into the notch and **slides down when your cursor goes to the top of the screen**, peeks for a few seconds whenever Claude's state changes, and **stays out the whole time Claude needs you** (so you never miss a `[y/n]`). Pointing at it keeps it open. Works on every platform (slides from the top edge where there's no notch).
- **Icon-only & cuter** munu (no text labels — the animation/glow says it all), a **smaller permission card**, and better visibility over fullscreen apps.

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
