# 75 Days Soft — Banks & Moore

A private 75 Soft challenge ledger for two people. One standalone `index.html`:
no build step, no dependencies, no account. Open it in a browser, or put it on a
phone home screen and use it like an app.

Malik and Janel each get an isolated ledger — own start date, own progress, own
theme (dark gold / light olive) — switched by the tab pair at the top.

## Using it on a phone

Open the page, then **Share → Add to Home Screen** (iOS) or **⋮ → Add to Home
screen** (Android). It launches full-screen with its own icon.

If you publish this repo with GitHub Pages (*Settings → Pages → Deploy from
branch → `main` / root*), the page is live at
`https://mtb796.github.io/75hard/` and both phones can just bookmark that.

## What it tracks

Six habits a day:

| Habit | Target |
|-------|--------|
| Workout | 20–30 minutes of movement |
| Diet | Protein & vegetables, no fast food, no sugar |
| Read | 10 pages of any book |
| Water | 1.5–2 liters |
| Sleep | At least 7 hours |
| Progress photo | Milestone days only |

75 days in three phases — I: 1–25, II: 26–50, III: 51–75.

**The photo is milestone-only** — days 1, 10, 20, 30, 40, 50, 60 and 75. On every
other day it is locked and excluded from the count, so a perfect day is 5/5
normally and 6/6 on a milestone.

**Streak** counts perfect days backwards from today. Today stays open until you
complete it, so the streak only breaks once a *finished* day is missed.

## Saving

`localStorage`, read synchronously before the first paint and written on every
change. That is the whole mechanism.

It is deliberately that plain. An earlier version also waited up to four seconds
at startup for an optional host-provided storage bridge before reading anything,
which meant the page spent those seconds displaying an empty ledger that looked
ready — and a tap in that window was saved over the top of the real record,
destroying the history behind it. The bridge is gone. There is no longer any
point at which the screen and the stored data disagree.

Vault codes remain, for the one thing local storage genuinely cannot do: move a
ledger to another device.

### What still will not persist

Storage is per-origin and per-browser, so these are expected, not bugs:

- **Different URLs are different storage.** A GitHub Pages address and a Vercel
  address each keep their own copy. Pick one and stick to it.
- **Add to Home Screen on iOS is a separate bucket** from Safari itself. Set the
  ledger up from the icon you will actually use day to day.
- **Private browsing** discards everything on close.
- **Two phones never merge.** Each device holds its own ledger; vault codes are
  how progress crosses between them.

### Moving a ledger between phones

Open **The Vault**, copy the code, paste it into the other device's *Restore*
box. `MB75-…` restores Malik, `JM75-…` restores Janel — the prefix picks the
side, so you cannot paste one person's history over the other's by accident.

## Vault code format

`MB75-` / `JM75-` prefix, then base64url over:

```
[version][dateHi][dateLo][packed habit bits …][checksumHi][checksumLo]
```

| Version | Habits/day | Epoch | Checksum | Bytes | Code chars |
|---------|-----------|-------|----------|-------|------------|
| 1 | 5 | 2020-01-01 | none | 50 | 67 |
| 2 | 6 | 2000-01-01 | Fletcher-16 | 62 | 83 |

Version 1 codes (written before the sleep habit existed) still restore, with
sleep decoding as unchecked. Decoding validates the version, the exact byte
length **and** the checksum, so a truncated or altered code is rejected with a
specific message rather than silently restoring partial data.

The key order and epoch of an existing version are the wire format. Never
reorder or retune them — add a new version instead.

## Mobile notes

- Every input is ≥16px, so iOS Safari does not zoom the page on focus.
- All controls are ≥44px tall; `touch-action: manipulation` removes the 300ms
  double-tap delay.
- `100dvh` and `env(safe-area-inset-*)` keep content clear of browser chrome,
  notches and the home indicator.
- `theme-color` follows the active side, so the browser bar matches the page.
- Saved progress is on screen the moment the page is usable — there is no window
  where an early tap can overwrite it.

## Fonts

Cinzel / Cormorant Garamond / Jost load from Google Fonts as a progressive
enhancement. Where that request is blocked — strict CSP, sandboxed iframe,
offline — every `font-family` ends in a real fallback of the same class, so
display text degrades to a serif rather than system sans. The stylesheet is
loaded with `media="print"` and promoted on load, because a render-blocking
sheet also blocks the scripts after it and would stall startup whenever the
request hangs.

## Tests

End-to-end against real Chromium, including four mobile viewports:

```
npm install
CHROME_PATH=/path/to/chrome npm test   # or just `npm test` if Playwright's browser is installed
```

Covers habit/rules parity, `localStorage` round-trips across a reload, the
the immediate-tap regression above, vault codec round-trips and every rejection path, v1
backward compatibility, the day-counter states, keyboard and ARIA behavior,
mobile layout and tap targets, and every button driving a real persisted change.
