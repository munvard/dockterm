<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__ — a calmer Claude workspace

Polish and quiet power for working with Claude Code — all local, no API, no telemetry.

- **Compose long prompts comfortably.** Press `⌘⇧⏎` (or the ✎ next to the chat) to open a roomy editor — write 100 lines, scroll and select freely, then **Insert** or **Send** into Claude. No more wrestling the cramped input box.
- **Hover any file to preview it.** Point at a file path in the output and a card appears — an image at its real aspect ratio, rendered markdown, or for a file Claude just touched, **the diff itself** (green/red). The card stays put so you can read and scroll it.
- **A live Changes panel, per terminal.** Each terminal's controls now has a Changes button — a floating list of the files changed in *that* terminal's project. Click a row's triangle to expand the diff: just the changes by default, or the full file.
- **References, not raw paste.** Select text in a terminal and “Send to Claude” frames it as a tidy quoted reference, leaving your cursor ready to ask about it.
- **One Claude button, more options.** The launcher is now a split button: **Claude** to start, with a menu for **Resume** and **Continue last**.
- **No more accidental closes.** Closing a terminal that's running Claude Code (or any process) asks first — so a misclick can't drop your session.

Plus fixes: the side-by-side diff no longer collapses to one column when the panel is narrow, and **Linux AppImage now updates itself in place** — the in-app updater swaps the new build in and restarts, no manual download-and-replace.

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
