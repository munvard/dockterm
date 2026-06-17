<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v0.17.0 — munu handles the whole flow

- **Fixed the multi-select "Submit → Cancel" bug.** Claude's post-submit review screen was being misread as multi-select (it echoes "(multi select)"), so its Submit mapped to Cancel. munu now classifies by real checkboxes, so the review screen is a normal Submit/Cancel pick that works.
- **Multi-step wizards.** Prompts with a step breadcrumb (Focus area › Change type › Submit) are now shown with their progress, and munu walks each step as Claude advances.
- **Option descriptions.** The helper text under each option is now shown in the card, so you know what you're picking.
- **Cancel from munu.** A cancel (Esc) action alongside "open terminal."
- Plus everything from v0.16.0: paced keystrokes, number-key single-select, and live multi-select toggles.

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
