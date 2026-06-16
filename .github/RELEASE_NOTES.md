## 🔎 What's new in v0.5.2 — bigger, comfier UI

- **The whole UI is now larger and adjustable.** Everything was too small on high-resolution displays. DockTerm now ships at a roomier default and you can scale the entire app — chrome, terminals, and the editor — with **⌘+ / ⌘− / ⌘0**, or the new **UI scale** control in Settings. Your choice is remembered.
- **Polish:** fixed a misaligned button in the tab bar and enlarged the cramped pane title bar.

## 🛠️ v0.5.1 — crash fix

- **Fixed a crash that could make the app unusable.** A saved multi-pane / multi-project session could, in rare cases, get into a state that blanked the window on every launch. DockTerm now validates the restored session and, if anything is wrong, shows a recovery screen with a one-click **Reset session & reload** instead of getting stuck. Your files on disk are never touched.

## ✨ New in v0.5.0 — UX power pack

- **See your files, not gibberish.** Click a PNG, JPG, SVG, GIF, etc. and it opens in an image viewer (click to fit/zoom). Binary or oversized files show a tidy card with *Reveal in folder* and *Open externally* instead of garbled text.
- **Drag a file onto a terminal** to type its full path at the prompt — works from the file tree and from Finder/Explorer. Drag a **folder** onto a pane to point that terminal at a different project.
- **One project per window — or many.** New windows (⌘N) open with a clean welcome screen (Open Folder + recent projects), just like an editor. Build a grid of terminals where each pane runs a *different* project; the side panels follow whichever pane you focus.
- **Better terminal scrolling.** ⌘↓ / ⌘↑ jump to the bottom / top, Shift+PageUp / PageDown page through history, and selecting text past the edge auto-scrolls.

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
