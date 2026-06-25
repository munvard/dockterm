<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__ — a deeper Claude workflow

Seven additions that make working with Claude Code in DockTerm faster and calmer.

- **Send selected text to Claude.** Select anything in a terminal and a little toolbar appears — one click drops it into Claude's prompt as a reference.
- **Checkpoints rail.** A new side panel lists your prompts to Claude; click one to scroll right back to it. “Rewind” opens Claude's own `/rewind` so you confirm the restore. Toggle it from a terminal's controls.
- **Start Claude / Resume buttons** right in each terminal's controls — run `claude` or `claude --resume` in one click.
- **Your terminals come back.** Quit DockTerm (e.g. to update) and reopen — each terminal's on-screen history is restored. (`claude --resume` continues the conversation.)
- **Drag real files out.** Multi-select files in the tree (⌘/Ctrl-click) and drag them straight into other apps — the actual files, not just their paths — or send them to Claude.
- **Cleaner copy/paste.** Fixed the garbled symbols (emoji, em-dashes) when pasting on macOS, and made copy explicit instead of copy-on-select.

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
