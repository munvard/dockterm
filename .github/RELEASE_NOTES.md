<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__: copy and paste fixed

- **Copy works again.** The Copy button on the selection toolbar, copy on select, `Ctrl Shift C` and every "Copy" button in the app silently did nothing. They now all use the system clipboard properly.
- **Right-click copies.** Select text in a normal terminal and right-click: it copies and clears the selection. On Windows, right-click with nothing selected pastes, and a multi-line clipboard is held back unless the program supports safe pasting.
- **Paste works on Windows.** `Ctrl V` pastes, and `Ctrl C` copies while text is selected (with nothing selected it still interrupts). `Ctrl Insert` and `Shift Insert` work on Windows and Linux. Linux keeps plain `Ctrl V` for vim, nano and emacs.
- **Big pastes.** Pasting more than 1 MB used to vanish without a message. It is now sent in pieces.
- **Layouts.** Copy and paste keys follow the letter you type, so Dvorak users no longer paste with `Ctrl K`.

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
