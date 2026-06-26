<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__ — scrolling that feels native, plus fixes

- **Scrolling feels like a normal terminal again.** Claude Code now renders **inline** by default and uses the terminal's own scrollback, so scrolling back through a conversation is smooth and native — no more fullscreen take-over. Prefer the flicker-free fullscreen TUI? Turn it on in **Settings → Terminal → Claude Code fullscreen TUI**.
- **munu drags reliably.** Fixed the intermittent “sticking” when dragging the pinned munu mascot — it now follows your cursor every time (the drag is tracked in the main process and can no longer flip click-through mid-drag).
- **The Changes panel stays put.** The floating Changes panel never pops open on its own anymore — it appears only when you click a terminal's Changes button.

All local and read-only on your own `~/.claude` files — no API, no telemetry.

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
