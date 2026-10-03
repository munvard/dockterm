<!-- RELEASE NOTES — keep ONLY the current release's "What's new" here. CI uses
     this whole file for the release body (replacing __VER__), so do NOT append
     past versions; replace this section each release. Older notes live in the
     git history and on each previous GitHub release. -->

## 🎯 What's new in v__VER__: Mac updates verify correctly

- **In-app updates on macOS now pass their checksum.** Each Mac build used to be uploaded twice by two CI jobs, so the checksum file could describe a different `.dmg` than the one you download. The updater would then refuse it. Each job now builds only its own chip, so the file and the download always match.
- **Signed and notarized by Moon Labs LLC** (since v0.32.2). It opens normally with no security warning.
- **If the in-app update does not install on your Mac,** download the new `.dmg` from this page once and drag DockTerm into Applications. The signer changed from a personal Apple account to Moon Labs, so macOS may ask for one manual install. Updates after that work as before.

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
