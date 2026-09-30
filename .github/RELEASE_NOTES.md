<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__: chat mode, reading comfort, and a much smoother Windows app

- **Chat mode.** Press `⌘R` (`Ctrl Shift R` on Windows and Linux) on any pane to see Claude's session as a clean conversation. Permission prompts become buttons, a timer shows how long Claude has been working, and the composer handles images, files, smart paste, `/` and `@` menus, history and drafts. The real terminal keeps running underneath.
- **Talk to Claude.** Hold the mic in the chat composer, or click it to toggle, to use Claude Code's own voice mode. If voice can't start, DockTerm shows Claude's reason instead of going silent.
- **Reading comfort.** A Reading view of the conversation (docked or floating), a warm low-glare Reading theme, line height, letter spacing and padding with one-tap presets, and Zen mode (`⌘.` / `Ctrl Shift .`) that dims the panes you are not using.
- **Windows, much smoother.**
  - No more 2 to 3 second freeze at launch: terminals now start in a background worker.
  - A slow shell start shows a dim "Starting shell…" line instead of an empty pane.
  - Restored terminal history is no longer overwritten by the new shell after a restart.
  - The native title bar is gone; the window buttons sit on DockTerm's own bar.
  - munu no longer flickers when you click it or when it changes size.
- **Shortcut changes.** The Review panel moved to `⌘E` / `Ctrl Shift E`, because `⌘R` is now chat mode. On Windows and Linux, Settings and zoom now use `Ctrl Shift`, so plain `Ctrl` keys always reach your shell.
- **Safer.** A security pass across the app: a trust check before reading repo git config that could run commands, stricter symlink handling in the project folder jail, update downloads that fail closed without a valid checksum, masked secrets in MCP commands, and a munu overlay that can reach only the few channels it needs.
- **A pinned munu may move once.** munu now remembers where its centre is, so it stays put when its size changes. After you update, a pinned munu can sit a little to the side of where you left it; drag it back once.

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
