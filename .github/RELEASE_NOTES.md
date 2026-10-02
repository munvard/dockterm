<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__: an average pace line, a calmer top bar, and a gentler Zen mode

- **Average pace marker on usage.** The 5-hour and 7-day readings now show where your usage would be if you spent the window evenly, so you see at a glance if you are above or below average. It is a tick on the ring and the bar, a dashed line on the graph, and a small arrow on the percent view. The tooltip gives the real numbers. On by default, with a switch in the pill settings and in the widget menu.
- **A calmer top bar.** There is always a free area to grab and drag the window, and the empty space in the tab strip drags it too. When space runs out, items give way in a fixed order instead of overlapping or wrapping. The usage pill is compact by default (`5h 11%`). Double-click the bar to zoom on macOS, and fullscreen drops the extra left padding.
- **Zen mode only hides the bars.** It no longer dims the panes you are not using or adds extra padding. It hides the top bar and the side panels and nothing else.
- **Windows fix.** A path separator bug in one test made CI fail on Windows. Fixed.

Everything from v0.32.0 is included: real 5-hour and 7-day usage from Claude itself, agents in munu, Quick Open and Find in files, a better file explorer, a much smoother app, and a clickable munu on Windows.

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
