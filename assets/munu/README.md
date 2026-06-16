# munu — the DockTerm mascot

**munu is the mini DockTerm: the workspace that woke up.** Where DockTerm wraps your
terminal and keeps quiet until you need it, munu is that same calm presence given a
face — a small violet sprite that sits next to you while `claude` runs.

The design is built straight out of DockTerm's own identity, so munu *is* the brand,
not a decoration bolted onto it:

- **Violet body** — the signature accent `#7c6bff` (lit top `#9a8cff` → grounded base `#6d59ee`).
- **Caret sprout** `^` on top — the terminal cursor, worn as a little cowlick.
- **Underscore smile** — the shell prompt `_`, smiling back at you.
- **Dark, shiny eyes** `#18141f` — the near-black of the DockTerm shell (`#0d0d0f`).
- Calm, kawaii, never loud — it belongs in a dark, focused pro tool.

## Files

| File | Use |
|------|-----|
| `munu.svg` | Primary mascot — resting/default, with ambient glow. Transparent bg. |
| `munu-icon.svg` | App-chip form — munu inside the DockTerm dark squircle. Scales to 16px. |
| `munu-happy.svg` | Joyful expression (closed eyes, sparkles). Empty states, success, celebrations. |
| `munu-working.svg` | Focused, with a blinking cursor + working dots (animated SMIL). Loading/busy. |
| `munu-sleeping.svg` | Resting, `z z z`. Idle / no-project / paused states. |
| `munu-wordmark.svg` | Logo lockup: mascot + `munu_` with a blinking shell cursor (animated). |
| `preview.html` | Open in a browser to see the whole kit on dark + light surfaces. |

## Palette

```
#7c6bff  accent (brand violet)      #0d0d0f  shell black
#9a8cff  body highlight             #18141f  eyes / features
#6d59ee  body base                  #ff8ab6  blush (kawaii warmth, sparing)
#b3a6ff  caret sprout / zzz / sparkle
```

All assets are hand-authored SVG (no fonts embedded except the wordmark, which uses the
system UI stack to match DockTerm). The `working` and `wordmark` cursors animate via inline
SMIL — they fall back to a solid block in renderers without SMIL.
