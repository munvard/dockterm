# ADR-007: Public repo, MIT license, honest-claims policy

- **Status:** Accepted (pending /ultraplan approval)
- **Date:** 2026-06-11
- **Inputs:** docs/research/01, 02, 10

## Context

DockTerm launches as a public GitHub repo (`dockterm`). Research shows the open-source +
local-first stance is the only durable moat versus Anthropic's own desktop app and
newly-open-sourced Warp; overclaiming would burn the trust the product is built on.

## Decision

- **License: MIT**, copyright "Menua Vardanyan" (sole author; updated 2026-06-21 from
  the placeholder "DockTerm contributors" to the named copyright holder. No monetization
  intent reaffirmed, so MIT stands — nothing to protect commercially).
- **Repo:** public `dockterm`; description: *"Terminal-first workspace for Claude Code —
  files, Git, MCP, and skills panels on demand. No telemetry. MIT."*; topics include
  `claude-code`, `terminal`, `electron`, `mcp`, `git`, `developer-tools`, `xtermjs`, `monaco`.
- **Tagline:** "Run `claude`. Everything else stays out of your way."
- README must include verbatim: *"DockTerm is terminal-first. The terminal stays central.
  Panels only appear when you need them."* and lead with the privacy stance
  (*"not opt-out, just absent"*).
- **Community files:** CONTRIBUTING.md (Windows + macOS dev setup incl. native rebuild),
  SECURITY.md (GitHub private advisories), CODE_OF_CONDUCT.md (Contributor Covenant 2.1),
  ROADMAP.md (V1 / V1.x / V2-ideas, futures clearly labeled).
- **Honest-claims policy (enforced in all copy):** never claim iTerm/Cursor replacement,
  enterprise security, MCP marketplace, perfect terminal compatibility, or macOS-signed
  builds before they exist. Status line: "early, production-focused V1".
- **Publish mechanics:** GitHub CLI is not installed on the dev machine → at publish time,
  print exact commands (`gh repo create dockterm --public ...` or manual remote add) for the
  user to run, or proceed if `gh` appears and is authenticated.

## Consequences

- MIT allows forks including commercial — accepted; community speed beats control.
- The 6–9 month identity window (research 01) makes launch quality (GIF, README) a
  release-blocking deliverable, not an afterthought.

## Alternatives rejected

- **AGPL** (Warp's choice): friction for the exact users we court; we have no SaaS to protect.
- **Org-owned repo / brand site first:** ceremony before product; revisit post-traction.
