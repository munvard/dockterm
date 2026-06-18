<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__ — accurate usage, smoother munu

**Usage that matches `/status`**
- The Usage panel + pill now show **% used and reset times that line up with Claude Code's own `/status`** — calibrated against your plan (auto-detected) and cost-weighted, so cache reads no longer skew the numbers. It's still read entirely from your local sessions; run `/status` for the exact figures.
- **Turn it off** anytime in **Settings → Usage** (with a plan picker), and it **auto-hides** if you don't use Claude Code on this machine.

**munu polish**
- **No more flicker** when you pin/unpin munu, and the quick-settings popup opens and closes snappily.

Plus everything from v0.24.0: the Usage panel, native terminal scrolling, default tab/window shortcuts (⌘T/⌘N/⌘W ↔ Ctrl+Shift+T/N/W), drag-to-reorder panes, new themes (Aubergine, Gruvbox Dark, Paper), and pinnable munu with new characters.

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
