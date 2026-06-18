<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v0.22.0 — agents, smarter panels, a real settings pass

- **Skills & Commands now actually show up.** They're scanned from your installed **plugins** and user config too (not just the project) — fixing the "No skills & commands found" you'd hit in a fresh folder.
- **New Agents panel.** See your Claude Code subagents (`.claude/agents`) — project, user, and plugin — with descriptions.
- **Pick your terminal font from a list.** No more typing font names — choose from a dropdown (with a live preview), or "Custom…" for anything else.
- **Resize munu.** A size control in Settings (Small → Extra large); the default is unchanged.
- **Point DockTerm at custom config folders.** If you keep skills, commands, agents, or an MCP config somewhere non-standard, set the paths in Settings.
- **Update notifications.** DockTerm now checks GitHub on launch (and every few hours) and shows a popup when a new version is out — with Update now / Remind me later / Skip. It never installs anything on its own.
- **Clearer settings** with plain-language help under each option (what *beginner mode* and *read user config* actually do).
- **Calmer grids.** A pane's title no longer repeats the tab's folder name in a same-project grid.

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
