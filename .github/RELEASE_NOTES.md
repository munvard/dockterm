<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v0.18.0 — munu, everywhere and rock-solid

- **Visible over fullscreen apps.** Fixed the macOS setup that kept munu off another app's fullscreen Space — it now floats on every Space (the previous build skipped the process-type transform that makes this work).
- **Bigger and always fully visible.** munu is a touch larger, the card is wider, and a long menu now scrolls inside a card sized to your actual screen — nothing clips.
- **Multi-select can't mis-select anymore.** Toggling is now instant in the card and sends one clean, ordered sequence on Submit (computed from Claude's real cursor), so fast/random clicking always submits exactly what you picked.
- **"Type something" → type right in munu.** Pick a free-text option and a text field opens in the card (or open the terminal to type there).
- Plus everything from v0.17.0: wizard steps, option descriptions, the review-screen fix, and Cancel.

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
