<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v0.16.0 — munu answers the *right* option

- **Fixed: munu picking the wrong choice.** Answers are now sent as separate, paced keypresses (Claude's TUI was coalescing a burst of keys into one and ignoring the rest). Picking the 3rd option now actually picks the 3rd.
- **Single-select uses the number key** — instant and reliable, no arrow guesswork.
- **Multi-select works live.** Toggling a checkbox in munu now flips it in the terminal immediately (Enter-to-toggle + paced arrow navigation), and Submit finalizes the exact set you picked.
- Plus everything from v0.15.0: the right font back, a card that fits its content, and the card only popping when you can't see the terminal.

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
