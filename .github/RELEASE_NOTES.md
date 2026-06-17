<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v0.20.0 — munu truly floats over fullscreen

- **Visible over another app's fullscreen Space (macOS).** This is the real fix: the overlay is now a macOS **panel window** (the same non-activating NSPanel trick native notch apps use), so munu floats over fullscreened apps on other desktops — not just regular windows. Also removes the launch flicker.
- **Instant state on answer.** Clicking Yes / Submit / a choice closes the card and updates munu **immediately** (no more ~2s lag waiting for the old menu to scroll out of the buffer).
- **Dock shows the right project.** Folders without their own `.git` no longer collapse up to your home directory (a `.git` in `$HOME` was claiming them).
- Plus everything from v0.18.0: bigger/fully-visible card, robust multi-select, and the "Type something" text field.

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
