# DockTerm Security Model

DockTerm spawns shells, edits files, runs git, and (opt-in) reads Claude config.
It markets hard guarantees: **no telemetry, no accounts, no cloud, no stored
tokens, no remote content.** This document is the model behind those claims.

## Renderer containment

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes a single frozen `window.dockterm` (invoke + on) — no Node
  objects, no arbitrary IPC channels.
- Production loads from a custom **`app://` protocol** (correct MIME + CSP, avoids
  `file://` elevated privileges). Dev loads the Vite server URL.
- Navigation is blocked (`will-navigate`), `window.open` is denied, and external
  links are opened via `shell.openExternal` only after a scheme check
  (`http(s)://` only — not a per-domain allowlist; any https link can open the
  system browser, the same as clicking one in any other app).
- `setPermissionRequestHandler` / `setPermissionCheckHandler` deny everything.
- **CSP** (production): no remote origins; `worker-src blob:` for Monaco/xterm
  workers; `unsafe-eval` only for the packaged `app://` origin (Monaco needs it),
  never with any remote script present. Set both via `webRequest.onHeadersReceived`
  and directly on every `protocol.handle('app', ...)` response (the two hooks
  aren't guaranteed to overlap for every request), gated to packaged builds only.
- `ELECTRON_RENDERER_URL` (electron-vite's dev-server URL) is honored by the
  trusted-sender check and the overlay's initial load **only when
  `!app.isPackaged`** — a packaged build can't be pointed at an arbitrary origin
  just because that variable is set in its environment.
- The munu overlay window gets its own, smaller IPC allowlist (`munu:*`,
  `settings:get/set`, `app:getInfo`, `activity:get`) enforced centrally in the
  registrar — it has no access to `fs:*`/`git:*`/`pty:*`/`project:*` even
  though it's an equally trusted (`app://`) renderer.
- **Fuses** flipped at package time (`build/afterPack.cjs`): `RunAsNode` off,
  `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off,
  `OnlyLoadAppFromAsar` on, `GrantFileProtocolExtraPrivileges` off (`file://` is
  never used to load app content). Asar integrity validation is **not** enabled:
  it requires electron-builder to embed a matching integrity header at package
  time, which this project's afterPack-driven fuse flip doesn't do — turning the
  fuse on without that pairing would make the packaged app refuse to launch.

## IPC discipline

- Verb-specific channels only — no `fs:call(method, args)` confused-deputy.
- Every handler: `senderFrame` origin check → zod schema (with size caps) →
  handler → typed `Result`. Errors are `{ code, message }`, never raw stacks.

## Filesystem jail

`pathJail.resolveInside(root, relPath)` canonicalizes the root with `realpath`,
resolves the candidate, canonicalizes its nearest existing ancestor (so a symlink
mid-path can't escape), then prefix-checks — **case-insensitive on Windows**.
Traversal, absolute-outside, and symlink escapes throw `JailViolation`. The
watcher runs with `followSymlinks: false`.

Two additional capabilities are scoped **separately**, not by widening the jail:
the read-only, opt-in Claude user config (`~/.claude*`) and the app's own
`userData` config.

## Execution discipline

- The PTY runs whatever the user types — DockTerm grants no privilege a terminal
  doesn't. The control is *who can drive it*: only the sandboxed local renderer,
  and no remote content is ever loaded.
- Commands DockTerm itself constructs (git, project detection) use
  `execFile`/`spawn` with **array args, never `shell: true`**, never string
  concatenation.
- **Every `git` invocation sets `-c core.hooksPath=`** so an opened, untrusted
  repo's hooks can never execute (CVE-2024-32002 class). simple-git's
  `allowUnsafeHooksPath` is opted into *only* to set the empty, hook-disabling
  value.
- "Run script" buttons **paste into the mini terminal** — visible execution, never
  an invisible `exec`.
- Force push is only ever `--force-with-lease`. Hard reset, `git clean`, and
  unmerged-branch deletion are not in the UI — omission is the safety feature.

## Secrets

The MCP/skills panels are **parse-only and never execute anything**. `env` and
`header` values are reduced to key names; URLs are shown host-only with query and
embedded credentials stripped (`secretMask`). Secrets are never logged and never
written to app config. User-scope Claude config is read only when the user opts
in **and** the panel requests it (a double gate, default off).

## Privacy

No telemetry, analytics, or crash reporting exist in the code. At runtime the app
makes no network calls except the git operations you initiate, the external links
you click, and an optional check to GitHub for new releases (used for in-app
updates; on by default and toggleable in Settings → "Check automatically").

The update check itself only ever downloads from
`https://github.com/munvard/dockterm/releases/download/…` (pinned prefix, checked
before every download), and verifies the downloaded installer's sha512 against
the release's electron-builder-generated `latest*.yml` before opening/relaunching
it. A missing or unreachable checksum degrades to "download without a verifiable
hash" rather than refusing to update at all — the pinned HTTPS host is the
baseline guarantee either way.

## Linux notes

Electron's Chromium sandbox needs a `setuid` helper that some distros, and most
containers/CI runners, don't have set up. If the AppImage (or the `.deb`) refuses
to start with a sandbox error, run it with `--no-sandbox`. This does not affect
`contextIsolation`/`nodeIntegration`/renderer-process isolation, which are
Electron/DockTerm settings independent of the OS-level Chromium sandbox.

## What we do not claim

Enterprise security, perfect sandboxing of arbitrary terminal programs, or signed
builds (V1 ships unsigned). This is young software — please report issues per
[SECURITY.md](../SECURITY.md).
